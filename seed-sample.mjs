// Seed sample data via API (must be run while server is up)
const BASE = "http://localhost:5000";

let cookie = "";
async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`${method} ${path} -> ${res.status}: ${t}`);
  }
  // capture set-cookie
  const sc = res.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  const ct = res.headers.get("content-type") || "";
  return ct.includes("json") ? res.json() : res.text();
}

await api("POST", "/api/login", { password: "kayur2026" });
console.log("logged in");

// Skip if already seeded
const existingAccounts = await api("GET", "/api/accounts");
if (existingAccounts.length > 0) {
  console.log("Already have accounts; skipping seed.");
  process.exit(0);
}

const checking = await api("POST", "/api/accounts", {
  name: "Chase Checking",
  type: "checking",
  currency: "USD",
  startingBalance: 850000, // $8,500
  archived: false,
});
console.log("checking", checking.id);

const card = await api("POST", "/api/accounts", {
  name: "Amex Platinum",
  type: "credit_card",
  currency: "USD",
  startingBalance: 0,
  archived: false,
});
console.log("card", card.id);

const cats = await api("GET", "/api/categories");
const businesses = await api("GET", "/api/businesses");
const findCat = (n) => cats.find((c) => c.name === n)?.id ?? null;
const findBiz = (n) => businesses.find((b) => b.name === n)?.id ?? null;

// helper for date n days ago
const today = new Date();
const dateAgo = (d) => {
  const x = new Date(today);
  x.setDate(x.getDate() - d);
  return x.toISOString().slice(0, 10);
};

const tx = (overrides) => ({
  date: dateAgo(0),
  amount: -1000,
  description: "",
  merchant: null,
  categoryId: null,
  entity: "Personal",
  isBusinessExpense: false,
  businessId: null,
  reconciled: false,
  pending: false,
  ...overrides,
});

const sampleTxs = [
  // Income
  tx({ accountId: checking.id, date: dateAgo(28), amount: 525000, description: "Payroll - April pay 1", merchant: "Direct Deposit", categoryId: findCat("Salary") }),
  tx({ accountId: checking.id, date: dateAgo(14), amount: 525000, description: "Payroll - April pay 2", merchant: "Direct Deposit", categoryId: findCat("Salary") }),
  tx({ accountId: checking.id, date: dateAgo(7), amount: 4523, description: "Interest", merchant: "Chase", categoryId: findCat("Interest") }),

  // Checking expenses
  tx({ accountId: checking.id, date: dateAgo(2), amount: -198750, description: "April mortgage", merchant: "Wells Fargo Home Mortgage", categoryId: findCat("Mortgage/Rent") }),
  tx({ accountId: checking.id, date: dateAgo(8), amount: -14299, description: "Electric bill", merchant: "National Grid", categoryId: findCat("Utilities") }),
  tx({ accountId: checking.id, date: dateAgo(10), amount: -8512, description: "Internet", merchant: "Spectrum", categoryId: findCat("Utilities") }),
  tx({ accountId: checking.id, date: dateAgo(15), amount: -45000, description: "Auto insurance", merchant: "Geico", categoryId: findCat("Insurance") }),
  tx({ accountId: checking.id, date: dateAgo(20), amount: -12000, description: "Gym membership", merchant: "Equinox", categoryId: findCat("Subscriptions") }),

  // Card — personal
  tx({ accountId: card.id, date: dateAgo(1), amount: -4286, description: "Whole Foods", merchant: "Whole Foods Market", categoryId: findCat("Groceries") }),
  tx({ accountId: card.id, date: dateAgo(3), amount: -8742, description: "Trader Joe's run", merchant: "Trader Joes", categoryId: findCat("Groceries") }),
  tx({ accountId: card.id, date: dateAgo(2), amount: -2150, description: "Espresso & croissant", merchant: "Blue Bottle", categoryId: findCat("Coffee") }),
  tx({ accountId: card.id, date: dateAgo(4), amount: -1875, description: "Coffee", merchant: "Starbucks", categoryId: findCat("Coffee") }),
  tx({ accountId: card.id, date: dateAgo(5), amount: -6450, description: "Dinner with Anita", merchant: "The Fox & Hound", categoryId: findCat("Dining Out") }),
  tx({ accountId: card.id, date: dateAgo(6), amount: -3275, description: "Sushi takeout", merchant: "Sakura", categoryId: findCat("Dining Out") }),
  tx({ accountId: card.id, date: dateAgo(9), amount: -5840, description: "Gas fill", merchant: "Shell", categoryId: findCat("Gas") }),
  tx({ accountId: card.id, date: dateAgo(12), amount: -12999, description: "New running shoes", merchant: "Nike.com", categoryId: findCat("Clothing") }),
  tx({ accountId: card.id, date: dateAgo(11), amount: -1599, description: "Spotify Family", merchant: "Spotify", categoryId: findCat("Subscriptions") }),
  tx({ accountId: card.id, date: dateAgo(13), amount: -2299, description: "Netflix", merchant: "Netflix", categoryId: findCat("Subscriptions") }),
  tx({ accountId: card.id, date: dateAgo(16), amount: -7800, description: "Movie + popcorn", merchant: "AMC Theaters", categoryId: findCat("Entertainment") }),
  tx({ accountId: card.id, date: dateAgo(18), amount: -3450, description: "Haircut", merchant: "Roosters", categoryId: findCat("Personal Care") }),
  tx({ accountId: card.id, date: dateAgo(22), amount: -25800, description: "Anniversary dinner", merchant: "Otto's Steakhouse", categoryId: findCat("Dining Out") }),
  tx({ accountId: card.id, date: dateAgo(24), amount: -8625, description: "Target run", merchant: "Target", categoryId: findCat("Shopping") }),

  // Card — BUSINESS expenses (will be owed)
  tx({ accountId: card.id, date: dateAgo(3), amount: -42500, description: "Linen restock — Cicero", merchant: "HD Supply", categoryId: findCat("Shopping"), isBusinessExpense: true, businessId: findBiz("Cicero Grand") }),
  tx({ accountId: card.id, date: dateAgo(7), amount: -18750, description: "Cleaning supplies — Syracuse", merchant: "Sam's Club", categoryId: findCat("Shopping"), isBusinessExpense: true, businessId: findBiz("Syracuse Grand") }),
  tx({ accountId: card.id, date: dateAgo(9), amount: -9425, description: "Coffee service — Super 8", merchant: "Costco Business", categoryId: findCat("Shopping"), isBusinessExpense: true, businessId: findBiz("Super 8") }),
  tx({ accountId: card.id, date: dateAgo(12), amount: -32100, description: "PPE & gloves — PuroClean", merchant: "Grainger", categoryId: findCat("Shopping"), isBusinessExpense: true, businessId: findBiz("PuroClean") }),
  tx({ accountId: card.id, date: dateAgo(15), amount: -15600, description: "Light bulbs — Cicero", merchant: "Home Depot", categoryId: findCat("Home Maintenance"), isBusinessExpense: true, businessId: findBiz("Cicero Grand") }),
  tx({ accountId: card.id, date: dateAgo(20), amount: -28400, description: "Mileage — site visits", merchant: "Shell", categoryId: findCat("Gas"), isBusinessExpense: true, businessId: findBiz("PuroClean") }),
];

for (const t of sampleTxs) {
  await api("POST", "/api/transactions", t);
}
console.log(`seeded ${sampleTxs.length} transactions`);

// Bills
const bills = [
  { name: "Mortgage", payee: "Wells Fargo", amount: 198750, dueDay: 1, frequency: "monthly", nextDueDate: dateAgo(-3), accountId: checking.id, categoryId: findCat("Mortgage/Rent"), autopay: true, reminderDaysBefore: 5, archived: false },
  { name: "Electric", payee: "National Grid", amount: 14000, dueDay: 22, frequency: "monthly", nextDueDate: dateAgo(-12), accountId: checking.id, categoryId: findCat("Utilities"), autopay: true, reminderDaysBefore: 3, archived: false },
  { name: "Internet", payee: "Spectrum", amount: 8500, dueDay: 18, frequency: "monthly", nextDueDate: dateAgo(-8), accountId: checking.id, categoryId: findCat("Utilities"), autopay: false, reminderDaysBefore: 3, archived: false },
  { name: "Auto insurance", payee: "Geico", amount: 45000, dueDay: 15, frequency: "monthly", nextDueDate: dateAgo(-15), accountId: checking.id, categoryId: findCat("Insurance"), autopay: true, reminderDaysBefore: 3, archived: false },
];
for (const b of bills) {
  await api("POST", "/api/bills", b);
}
console.log(`seeded ${bills.length} bills`);

console.log("DONE");
