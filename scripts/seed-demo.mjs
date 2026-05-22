#!/usr/bin/env node
// scripts/seed-demo.mjs
//
// Creates the demo tenant ("Stack Public Library") plus a realistic catalog
// (~50 books) and ~16 demo member rows spanning all roles and statuses.
//
// Idempotent: if a tenant with slug='stack-public' already exists, the script
// reuses it; books/members are upserted by their natural key.
// Books: newly seeded rows get cover_url + description; previously seeded rows
// get an UPDATE to pick up cover_url/description when those columns are NULL.
//
// Auth0 org override:
//   Set DEMO_AUTH0_ORG_ID in .env.local to point the demo tenant at a real
//   Auth0 Organization after first deploy.  If the tenant already exists and
//   DEMO_AUTH0_ORG_ID differs from the stored auth0_org_id, the script updates
//   the stored value and logs the change.
//
// Prerequisites:
//   - Migrations 0000-0007 applied.
//   - DATABASE_URL_UNPOOLED set in .env.local (neondb_owner, BYPASSRLS).
//
// Usage:
//   node --env-file=.env.local scripts/seed-demo.mjs
//
// What this seed deliberately does NOT do:
//   - Issue loans or holds — that's seed-circulation.mjs's job.
//   - Wire Auth0 users — auth0_user_id is left NULL; sign-in flow will link
//     real Auth0 sub → existing member row at first login.

import { randomUUID } from "node:crypto";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

const ownerUrl = process.env.DATABASE_URL_UNPOOLED;
if (!ownerUrl) {
  console.error("ERROR: DATABASE_URL_UNPOOLED not set");
  process.exit(1);
}
if (ownerUrl.startsWith("<") || !/^postgres(ql)?:\/\//.test(ownerUrl)) {
  console.error("ERROR: DATABASE_URL_UNPOOLED looks like a placeholder");
  process.exit(1);
}

function maskUrl(u) {
  try {
    const p = new URL(u);
    p.password = "***";
    return p.toString();
  } catch {
    return "<unparseable url>";
  }
}

// ---------------------------------------------------------------------------
// Demo content
// ---------------------------------------------------------------------------

const DEMO_TENANT = {
  slug: "stack-public",
  name: "Stack Public Library",
  auth0OrgId: "org_stack_public_demo",
  brandVoice: "Warm, literary, neighborhood.",
};

// Auth0 org override — lets a post-deploy re-seed wire the tenant to a real org.
const authOrgId = process.env.DEMO_AUTH0_ORG_ID ?? DEMO_TENANT.auth0OrgId;

/** Build an OpenLibrary cover URL for the given ISBN-13. */
function coverUrl(isbn13) {
  return `https://covers.openlibrary.org/b/isbn/${isbn13}-L.jpg`;
}

const DEMO_BOOKS = [
  // --- Original 8 (preserved) ---
  {
    isbn13: "9780132350884",
    title: "Clean Code",
    authors: ["Robert C. Martin"],
    year: 2008,
    publisher: "Prentice Hall",
    pageCount: 464,
    subjects: ["Software Engineering", "Programming"],
    language: "en",
    description:
      "A handbook of agile software craftsmanship that teaches programmers to write clean, readable, and maintainable code through pragmatic principles and real-world examples.",
  },
  {
    isbn13: "9780201633610",
    title: "Design Patterns",
    authors: ["Erich Gamma", "Richard Helm", "Ralph Johnson", "John Vlissides"],
    year: 1994,
    publisher: "Addison-Wesley",
    pageCount: 395,
    subjects: ["Software Engineering", "Object-Oriented Programming"],
    language: "en",
    description:
      "The canonical catalog of twenty-three reusable design patterns for object-oriented software, with C++ and Smalltalk examples that remain relevant across languages and decades.",
  },
  {
    isbn13: "9780374533557",
    title: "Thinking, Fast and Slow",
    authors: ["Daniel Kahneman"],
    year: 2011,
    publisher: "Farrar, Straus and Giroux",
    pageCount: 499,
    subjects: ["Psychology", "Cognitive Science"],
    language: "en",
    description:
      "Nobel laureate Daniel Kahneman explores the two systems that drive the way we think—fast, intuitive thinking and slow, deliberate reasoning—and their impact on our choices.",
  },
  {
    isbn13: "9780140449136",
    title: "The Odyssey",
    authors: ["Homer"],
    year: 1996,
    publisher: "Penguin Classics",
    pageCount: 560,
    subjects: ["Classics", "Epic Poetry"],
    language: "en",
    description:
      "Homer's epic follows the cunning Odysseus on his ten-year voyage home from Troy, battling gods, monsters, and temptation in one of literature's greatest adventure stories.",
  },
  {
    isbn13: "9780062315007",
    title: "The Alchemist",
    authors: ["Paulo Coelho"],
    year: 1988,
    publisher: "HarperOne",
    pageCount: 208,
    subjects: ["Fiction", "Philosophy"],
    language: "en",
    description:
      "A young Andalusian shepherd travels from Spain to Egypt in pursuit of a treasure and a personal legend, discovering that the journey itself holds the deepest wisdom.",
  },
  {
    isbn13: "9780451524935",
    title: "1984",
    authors: ["George Orwell"],
    year: 1949,
    publisher: "Signet Classics",
    pageCount: 328,
    subjects: ["Fiction", "Dystopian"],
    language: "en",
    description:
      "Orwell's chilling portrait of a totalitarian society under the surveillance of Big Brother remains the defining novel of political repression and the fragility of truth.",
  },
  {
    isbn13: "9780743273565",
    title: "The Great Gatsby",
    authors: ["F. Scott Fitzgerald"],
    year: 1925,
    publisher: "Scribner",
    pageCount: 180,
    subjects: ["Fiction", "Classic"],
    language: "en",
    description:
      "Set in the glittering Jazz Age, Fitzgerald's masterpiece captures the American Dream's allure and corruption through the eyes of Nick Carraway and the enigmatic Jay Gatsby.",
  },
  {
    isbn13: "9780393358070",
    title: "Sapiens: A Brief History of Humankind",
    authors: ["Yuval Noah Harari"],
    year: 2015,
    publisher: "Harper Perennial",
    pageCount: 464,
    subjects: ["History", "Anthropology"],
    language: "en",
    description:
      "From the Stone Age to the twenty-first century, Harari surveys the history of our species, asking how Homo sapiens came to dominate the planet and at what cost.",
  },

  // --- Literary Fiction ---
  {
    isbn13: "9780385333481",
    title: "The Handmaid's Tale",
    authors: ["Margaret Atwood"],
    year: 1985,
    publisher: "Anchor Books",
    pageCount: 311,
    subjects: ["Fiction", "Dystopian"],
    language: "en",
    description:
      "In the theocratic Republic of Gilead, Offred narrates her life as a Handmaid—a woman assigned to bear children for an elite couple—in Atwood's searing feminist dystopia.",
  },
  {
    isbn13: "9780374528379",
    title: "One Hundred Years of Solitude",
    authors: ["Gabriel García Márquez"],
    year: 1967,
    publisher: "Harper Perennial Modern Classics",
    pageCount: 417,
    subjects: ["Fiction", "Magical Realism"],
    language: "en",
    description:
      "The Buendía family saga across seven generations in the mythical town of Macondo is García Márquez's towering achievement and the defining novel of magical realism.",
  },
  {
    isbn13: "9780525559474",
    title: "Normal People",
    authors: ["Sally Rooney"],
    year: 2018,
    publisher: "Faber & Faber",
    pageCount: 273,
    subjects: ["Fiction", "Contemporary"],
    language: "en",
    description:
      "Connell and Marianne navigate a complex, on-again-off-again relationship from small-town Ireland to Trinity College Dublin in Rooney's nuanced portrait of modern intimacy.",
  },
  {
    isbn13: "9780679720201",
    title: "The Stranger",
    authors: ["Albert Camus"],
    year: 1942,
    publisher: "Vintage",
    pageCount: 123,
    subjects: ["Fiction", "Existentialism"],
    language: "en",
    description:
      "Meursault, an emotionally detached French Algerian, commits a murder and faces trial in Camus's spare, unsettling exploration of absurdism and the indifference of the universe.",
  },

  // --- Science Fiction ---
  {
    isbn13: "9780441013593",
    title: "Dune",
    authors: ["Frank Herbert"],
    year: 1965,
    publisher: "Ace Books",
    pageCount: 688,
    subjects: ["Science Fiction", "Epic Fantasy"],
    language: "en",
    description:
      "On the desert planet Arrakis, young Paul Atreides becomes the fulcrum of an interstellar conflict over the universe's most precious resource in Herbert's epic world-building masterwork.",
  },
  {
    isbn13: "9780345391803",
    title: "The Hitchhiker's Guide to the Galaxy",
    authors: ["Douglas Adams"],
    year: 1979,
    publisher: "Del Rey",
    pageCount: 224,
    subjects: ["Science Fiction", "Humor"],
    language: "en",
    description:
      "Moments before Earth is demolished to make way for a hyperspace bypass, Arthur Dent is whisked into the cosmos by his alien friend Ford Prefect in this beloved comic sci-fi classic.",
  },
  {
    isbn13: "9780756404741",
    title: "The Name of the Wind",
    authors: ["Patrick Rothfuss"],
    year: 2007,
    publisher: "DAW Books",
    pageCount: 662,
    subjects: ["Fantasy", "Epic Fantasy"],
    language: "en",
    description:
      "The legendary wizard Kvothe recounts his extraordinary life—from a gifted child performer to the most feared man in the world—in Rothfuss's richly imagined first volume.",
  },
  {
    isbn13: "9780765326355",
    title: "The Way of Kings",
    authors: ["Brandon Sanderson"],
    year: 2010,
    publisher: "Tor Books",
    pageCount: 1007,
    subjects: ["Fantasy", "Epic Fantasy"],
    language: "en",
    description:
      "On the storm-ravaged world of Roshar, a surgeon-turned-soldier, a young woman thief, and a highprince's scholar are drawn into an ancient conflict in Sanderson's sprawling epic.",
  },
  {
    isbn13: "9780060512804",
    title: "Brave New World",
    authors: ["Aldous Huxley"],
    year: 1932,
    publisher: "Harper Perennial Modern Classics",
    pageCount: 311,
    subjects: ["Fiction", "Dystopian"],
    language: "en",
    description:
      "In a future society engineered for happiness through conditioning and drugs, Bernard Marx begins to question whether a life without suffering is truly worth living.",
  },

  // --- Mystery / Thriller ---
  {
    isbn13: "9780307269751",
    title: "The Girl with the Dragon Tattoo",
    authors: ["Stieg Larsson"],
    year: 2005,
    publisher: "Vintage Crime/Black Lizard",
    pageCount: 672,
    subjects: ["Mystery", "Thriller"],
    language: "en",
    description:
      "Journalist Mikael Blomkvist and hacker Lisbeth Salander investigate a decades-old disappearance within a powerful Swedish family in Larsson's propulsive Scandinavian thriller.",
  },
  {
    isbn13: "9780062409850",
    title: "Gone Girl",
    authors: ["Gillian Flynn"],
    year: 2012,
    publisher: "Crown Publishing",
    pageCount: 422,
    subjects: ["Mystery", "Thriller"],
    language: "en",
    description:
      "On their fifth anniversary, Nick Dunne's wife Amy vanishes and the media circus that follows reveals how little the couple really knew—or told—about each other.",
  },
  {
    isbn13: "9780385537858",
    title: "The Goldfinch",
    authors: ["Donna Tartt"],
    year: 2013,
    publisher: "Little, Brown and Company",
    pageCount: 771,
    subjects: ["Fiction", "Literary Fiction"],
    language: "en",
    description:
      "After a bombing kills his mother, thirteen-year-old Theo Decker holds onto a small Dutch masterpiece painting as an anchor through years of loss, crime, and self-destruction.",
  },

  // --- Popular Science ---
  {
    isbn13: "9780385472579",
    title: "A Brief History of Time",
    authors: ["Stephen Hawking"],
    year: 1988,
    publisher: "Bantam Books",
    pageCount: 212,
    subjects: ["Popular Science", "Physics"],
    language: "en",
    description:
      "Hawking guides general readers through the origin and fate of the universe, from the Big Bang to black holes and quantum mechanics, in the bestselling popular science book of all time.",
  },
  {
    isbn13: "9780393353440",
    title: "The Selfish Gene",
    authors: ["Richard Dawkins"],
    year: 1976,
    publisher: "Oxford University Press",
    pageCount: 360,
    subjects: ["Popular Science", "Evolutionary Biology"],
    language: "en",
    description:
      "Dawkins argues that evolution operates at the level of the gene, not the organism, transforming our understanding of altruism, cooperation, and what it means to be alive.",
  },
  {
    isbn13: "9780393351590",
    title: "The Emperor of All Maladies",
    authors: ["Siddhartha Mukherjee"],
    year: 2010,
    publisher: "Scribner",
    pageCount: 592,
    subjects: ["Popular Science", "Medicine"],
    language: "en",
    description:
      "Pulitzer Prize-winning oncologist Mukherjee writes a sweeping biography of cancer—its ancient origins, the long war against it, and the remarkable breakthroughs reshaping treatment.",
  },
  {
    isbn13: "9781491950357",
    title: "The Gene: An Intimate History",
    authors: ["Siddhartha Mukherjee"],
    year: 2016,
    publisher: "Scribner",
    pageCount: 608,
    subjects: ["Popular Science", "Genetics"],
    language: "en",
    description:
      "From Gregor Mendel's peas to CRISPR gene editing, Mukherjee weaves science, history, and ethics into an accessible chronicle of humanity's most powerful—and dangerous—discovery.",
  },

  // --- History ---
  {
    isbn13: "9780143127741",
    title: "Guns, Germs, and Steel",
    authors: ["Jared Diamond"],
    year: 1997,
    publisher: "W. W. Norton",
    pageCount: 480,
    subjects: ["History", "Anthropology"],
    language: "en",
    description:
      "Diamond explains why some civilizations came to dominate others not through racial superiority but through environmental advantages in geography, crops, and domesticable animals.",
  },
  {
    isbn13: "9781101970539",
    title: "Homo Deus: A Brief History of Tomorrow",
    authors: ["Yuval Noah Harari"],
    year: 2015,
    publisher: "Harper Perennial",
    pageCount: 464,
    subjects: ["History", "Futurism"],
    language: "en",
    description:
      "Harari turns his lens to the future, asking what humanity might become as it transcends mortality, develops artificial intelligence, and pursues god-like powers of creation.",
  },
  {
    isbn13: "9780735224292",
    title: "The Warmth of Other Suns",
    authors: ["Isabel Wilkerson"],
    year: 2010,
    publisher: "Vintage",
    pageCount: 622,
    subjects: ["History", "African American History"],
    language: "en",
    description:
      "Through three unforgettable lives, Wilkerson chronicles the Great Migration—the decades-long exodus of six million Black Americans from the Jim Crow South that remade the nation.",
  },

  // --- Biography / Memoir ---
  {
    isbn13: "9781501156700",
    title: "Educated",
    authors: ["Tara Westover"],
    year: 2018,
    publisher: "Random House",
    pageCount: 334,
    subjects: ["Memoir", "Education"],
    language: "en",
    description:
      "Raised by survivalist parents in the Idaho mountains with no formal schooling, Tara Westover educates herself into Cambridge and Harvard in this stunning memoir of self-invention.",
  },
  {
    isbn13: "9780812993547",
    title: "Between the World and Me",
    authors: ["Ta-Nehisi Coates"],
    year: 2015,
    publisher: "Spiegel & Grau",
    pageCount: 176,
    subjects: ["Memoir", "Race"],
    language: "en",
    description:
      "Written as a letter to his teenage son, Coates's searing meditation on race in America and the vulnerability of the Black body won the National Book Award.",
  },
  {
    isbn13: "9781400078776",
    title: "The Glass Castle",
    authors: ["Jeannette Walls"],
    year: 2005,
    publisher: "Scribner",
    pageCount: 288,
    subjects: ["Memoir", "Family"],
    language: "en",
    description:
      "Walls recounts her unconventional, often harrowing childhood with her brilliant, dysfunctional parents—vagabond intellectuals who prioritized freedom over stability—in a remarkable memoir.",
  },
  {
    isbn13: "9780593230060",
    title: "Crying in H Mart",
    authors: ["Michelle Zauner"],
    year: 2021,
    publisher: "Knopf",
    pageCount: 256,
    subjects: ["Memoir", "Music"],
    language: "en",
    description:
      "The Japanese Breakfast frontwoman writes about grief, identity, and Korean food after losing her mother to cancer in a memoir that is both devastating and life-affirming.",
  },

  // --- Business ---
  {
    isbn13: "9781501127625",
    title: "Shoe Dog",
    authors: ["Phil Knight"],
    year: 2016,
    publisher: "Scribner",
    pageCount: 400,
    subjects: ["Business", "Memoir"],
    language: "en",
    description:
      "Nike founder Phil Knight recounts the exhilarating and often near-disastrous early years of building one of the world's most iconic brands from a handshake deal in Japan.",
  },
  {
    isbn13: "9780735213500",
    title: "Bad Blood",
    authors: ["John Carreyrou"],
    year: 2018,
    publisher: "Knopf",
    pageCount: 352,
    subjects: ["Business", "Investigative Journalism"],
    language: "en",
    description:
      "Wall Street Journal reporter Carreyrou exposes how Elizabeth Holmes built Theranos into a multi-billion-dollar fraud and the whistleblowers who ultimately brought it down.",
  },
  {
    isbn13: "9781594484803",
    title: "Outliers",
    authors: ["Malcolm Gladwell"],
    year: 2008,
    publisher: "Little, Brown and Company",
    pageCount: 336,
    subjects: ["Business", "Psychology"],
    language: "en",
    description:
      "Gladwell examines what truly separates extraordinary achievers from everyone else, arguing that success is less about talent than opportunity, culture, and ten thousand hours of practice.",
  },
  {
    isbn13: "9780062316097",
    title: "Lean In",
    authors: ["Sheryl Sandberg"],
    year: 2013,
    publisher: "Knopf",
    pageCount: 240,
    subjects: ["Business", "Feminism"],
    language: "en",
    description:
      "Facebook's COO makes the case for women claiming their ambition and leaning into leadership, blending personal anecdote with data on workplace gender inequality.",
  },

  // --- Philosophy ---
  {
    isbn13: "9780679776222",
    title: "Meditations",
    authors: ["Marcus Aurelius"],
    year: 180,
    publisher: "Modern Library",
    pageCount: 254,
    subjects: ["Philosophy", "Stoicism"],
    language: "en",
    description:
      "The private journal of a Roman emperor, Meditations is a timeless guide to Stoic philosophy—on duty, impermanence, and how to live with clarity and equanimity.",
  },
  {
    isbn13: "9780140440300",
    title: "Nicomachean Ethics",
    authors: ["Aristotle"],
    year: 1953,
    publisher: "Penguin Classics",
    pageCount: 368,
    subjects: ["Philosophy", "Ethics"],
    language: "en",
    description:
      "Aristotle's foundational inquiry into human flourishing and the virtuous life remains the cornerstone of Western moral philosophy more than two thousand years after it was written.",
  },

  // --- Children's / YA ---
  {
    isbn13: "9780439023481",
    title: "The Hunger Games",
    authors: ["Suzanne Collins"],
    year: 2008,
    publisher: "Scholastic Press",
    pageCount: 374,
    subjects: ["Young Adult", "Dystopian"],
    language: "en",
    description:
      "In a post-apocalyptic North America, sixteen-year-old Katniss Everdeen volunteers to take her sister's place in a televised death match between children in Collins's riveting YA debut.",
  },
  {
    isbn13: "9780439708180",
    title: "Harry Potter and the Sorcerer's Stone",
    authors: ["J. K. Rowling"],
    year: 1997,
    publisher: "Scholastic",
    pageCount: 309,
    subjects: ["Young Adult", "Fantasy"],
    language: "en",
    description:
      "Orphaned Harry Potter discovers on his eleventh birthday that he is a wizard and begins his education at Hogwarts School of Witchcraft and Wizardry in Rowling's beloved series opener.",
  },
  {
    isbn13: "9780064400558",
    title: "Charlotte's Web",
    authors: ["E. B. White"],
    year: 1952,
    publisher: "HarperCollins",
    pageCount: 192,
    subjects: ["Children's Fiction", "Classic"],
    language: "en",
    description:
      "The spider Charlotte weaves words into her web to save her pig friend Wilbur from slaughter in one of the most beloved children's novels ever written.",
  },
  {
    isbn13: "9780385737951",
    title: "The Giver",
    authors: ["Lois Lowry"],
    year: 1993,
    publisher: "Ember",
    pageCount: 240,
    subjects: ["Young Adult", "Dystopian"],
    language: "en",
    description:
      "In a seemingly perfect community, twelve-year-old Jonas is assigned the singular role of Receiver of Memory, gradually uncovering the dark cost of his society's enforced sameness.",
  },

  // --- More literary / crossover picks ---
  {
    isbn13: "9780374202392",
    title: "The Road",
    authors: ["Cormac McCarthy"],
    year: 2006,
    publisher: "Vintage",
    pageCount: 287,
    subjects: ["Fiction", "Post-Apocalyptic"],
    language: "en",
    description:
      "A father and son travel a desolate, ash-covered America after an unnamed catastrophe in McCarthy's Pulitzer Prize-winning meditation on survival, love, and the persistence of good.",
  },
  {
    isbn13: "9780385490818",
    title: "The Kite Runner",
    authors: ["Khaled Hosseini"],
    year: 2003,
    publisher: "Riverhead Books",
    pageCount: 371,
    subjects: ["Fiction", "Historical Fiction"],
    language: "en",
    description:
      "Amir, a wealthy Afghan boy, betrays his servant Hassan in childhood and spends decades searching for redemption in Hosseini's searing debut novel spanning pre-war Kabul to America.",
  },
  {
    isbn13: "9780743477123",
    title: "To Kill a Mockingbird",
    authors: ["Harper Lee"],
    year: 1960,
    publisher: "Grand Central Publishing",
    pageCount: 336,
    subjects: ["Fiction", "Classic"],
    language: "en",
    description:
      "Through the eyes of young Scout Finch, Harper Lee's Pulitzer-winning novel explores racial injustice and moral courage in Depression-era Alabama as her father defends a wrongly accused Black man.",
  },
  {
    isbn13: "9780143038412",
    title: "Crime and Punishment",
    authors: ["Fyodor Dostoevsky"],
    year: 1866,
    publisher: "Penguin Classics",
    pageCount: 671,
    subjects: ["Fiction", "Classic"],
    language: "en",
    description:
      "A destitute St. Petersburg student murders a pawnbroker and grapples with guilt, paranoia, and moral consequence in Dostoevsky's towering psychological novel.",
  },
];

// Attach coverUrl to every entry.
for (const b of DEMO_BOOKS) {
  b.coverUrl = coverUrl(b.isbn13);
}

const DEMO_MEMBERS = [
  // Roles: 1 tenant_admin, 2 librarians, 10 active members, 2 pending, 1 suspended
  {
    email: "admin@stack-public.demo",
    displayName: "Avery Administrator",
    role: "tenant_admin",
    status: "active",
    canBorrow: true,
  },
  {
    email: "librarian@stack-public.demo",
    displayName: "Lena Librarian",
    role: "librarian",
    status: "active",
    canBorrow: true,
  },
  {
    email: "marcus@stack-public.demo",
    displayName: "Marcus Reyes",
    role: "librarian",
    status: "active",
    canBorrow: true,
  },
  // Active members
  {
    email: "ada@stack-public.demo",
    displayName: "Ada Lovelace",
    role: "member",
    status: "active",
    canBorrow: true,
  },
  {
    email: "alan@stack-public.demo",
    displayName: "Alan Turing",
    role: "member",
    status: "active",
    canBorrow: true,
  },
  {
    email: "grace@stack-public.demo",
    displayName: "Grace Hopper",
    role: "member",
    status: "active",
    canBorrow: true,
  },
  {
    email: "claude@stack-public.demo",
    displayName: "Claude Shannon",
    role: "member",
    status: "active",
    canBorrow: true,
  },
  {
    email: "emmy@stack-public.demo",
    displayName: "Emmy Noether",
    role: "member",
    status: "active",
    canBorrow: true,
  },
  {
    email: "richard@stack-public.demo",
    displayName: "Richard Feynman",
    role: "member",
    status: "active",
    canBorrow: true,
  },
  {
    email: "marie@stack-public.demo",
    displayName: "Marie Curie",
    role: "member",
    status: "active",
    canBorrow: true,
  },
  {
    email: "nikola@stack-public.demo",
    displayName: "Nikola Tesla",
    role: "member",
    status: "active",
    canBorrow: true,
  },
  {
    email: "dorothy@stack-public.demo",
    displayName: "Dorothy Vaughan",
    role: "member",
    status: "active",
    canBorrow: true,
  },
  {
    email: "katherine@stack-public.demo",
    displayName: "Katherine Johnson",
    role: "member",
    status: "active",
    canBorrow: true,
  },
  // Pending members (approval queue UI)
  {
    email: "newcomer@stack-public.demo",
    displayName: "Nora Newcomer",
    role: "member",
    status: "pending",
    canBorrow: false,
  },
  {
    email: "pending2@stack-public.demo",
    displayName: "Pablo Pendleton",
    role: "member",
    status: "pending",
    canBorrow: false,
  },
  // Suspended member
  {
    email: "suspended@stack-public.demo",
    displayName: "Sam Suspended",
    role: "member",
    status: "suspended",
    canBorrow: false,
  },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const pool = new Pool({ connectionString: ownerUrl, max: 1 });
  const client = await pool.connect();
  console.log(`seed-demo: connecting to ${maskUrl(ownerUrl)}`);

  try {
    // -- TENANT -----------------------------------------------------------
    let tenantId;
    const existing = await client.query("SELECT id, auth0_org_id FROM tenants WHERE slug = $1", [
      DEMO_TENANT.slug,
    ]);
    if (existing.rowCount > 0) {
      tenantId = existing.rows[0].id;
      const storedOrgId = existing.rows[0].auth0_org_id;
      console.log(`  tenant: "${DEMO_TENANT.name}" already present (id=${tenantId})`);

      // If an override org id is provided and differs from what's stored, update it.
      if (process.env.DEMO_AUTH0_ORG_ID && process.env.DEMO_AUTH0_ORG_ID !== storedOrgId) {
        await client.query("UPDATE tenants SET auth0_org_id = $1 WHERE id = $2", [
          authOrgId,
          tenantId,
        ]);
        console.log(`  tenant: auth0_org_id updated from "${storedOrgId}" to "${authOrgId}"`);
      }
    } else {
      tenantId = randomUUID();
      await client.query(
        `INSERT INTO tenants
           (id, auth0_org_id, name, slug, brand_voice, public_catalog_enabled)
         VALUES ($1, $2, $3, $4, $5, true)`,
        [tenantId, authOrgId, DEMO_TENANT.name, DEMO_TENANT.slug, DEMO_TENANT.brandVoice],
      );
      console.log(`  tenant: "${DEMO_TENANT.name}" created (id=${tenantId})`);
    }

    // -- BOOKS ------------------------------------------------------------
    let bInserted = 0;
    let bUpdated = 0;
    let bSkipped = 0;
    for (const b of DEMO_BOOKS) {
      const exists = await client.query(
        "SELECT id, cover_url FROM books WHERE tenant_id = $1 AND isbn13 = $2 AND deleted_at IS NULL",
        [tenantId, b.isbn13],
      );
      if (exists.rowCount > 0) {
        // If cover_url is missing, patch it (and description) without touching other columns.
        if (!exists.rows[0].cover_url) {
          await client.query("UPDATE books SET cover_url = $1, description = $2 WHERE id = $3", [
            b.coverUrl,
            b.description,
            exists.rows[0].id,
          ]);
          bUpdated++;
        } else {
          bSkipped++;
        }
        continue;
      }
      await client.query(
        `INSERT INTO books
           (tenant_id, isbn13, title, authors, year, publisher, page_count,
            subjects, language, cover_url, description)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          tenantId,
          b.isbn13,
          b.title,
          b.authors,
          b.year,
          b.publisher,
          b.pageCount,
          b.subjects,
          b.language,
          b.coverUrl,
          b.description,
        ],
      );
      bInserted++;
    }
    console.log(
      `  books: inserted=${bInserted} updated=${bUpdated} skipped=${bSkipped} total=${DEMO_BOOKS.length}`,
    );

    // -- MEMBERS ----------------------------------------------------------
    let mInserted = 0;
    let mSkipped = 0;
    for (const m of DEMO_MEMBERS) {
      const exists = await client.query(
        "SELECT id FROM members WHERE tenant_id = $1 AND email = $2",
        [tenantId, m.email],
      );
      if (exists.rowCount > 0) {
        mSkipped++;
        continue;
      }
      await client.query(
        `INSERT INTO members
           (tenant_id, display_name, email, status, role, can_borrow)
         VALUES ($1, $2, $3, $4::member_status, $5::member_role, $6)`,
        [tenantId, m.displayName, m.email, m.status, m.role, m.canBorrow],
      );
      mInserted++;
    }
    console.log(
      `  members: inserted=${mInserted} skipped=${mSkipped} total=${DEMO_MEMBERS.length}`,
    );

    console.log(`\nseed-demo: done. Use tenant id ${tenantId} in DEV_BYPASS_TENANT_ID.`);
  } finally {
    client.release();
    await pool.end();
  }
}

await main();
