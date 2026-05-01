// Built-in merchant pattern dictionary used to auto-suggest a category during import.
// Each entry: substring match (case-insensitive) -> category name (must exist in DEFAULT_CATEGORIES).
// Order matters: more specific patterns first.
export interface MerchantPattern {
  match: string;        // substring (lowercased) to look for in description+merchant
  category: string;     // category name to assign
  cleanName?: string;   // optional canonical merchant name to surface
}

export const MERCHANT_PATTERNS: MerchantPattern[] = [
  // ===== Transportation =====
  { match: "uber eats", category: "Dining Out", cleanName: "Uber Eats" },
  { match: "ubereats", category: "Dining Out", cleanName: "Uber Eats" },
  { match: "doordash", category: "Dining Out", cleanName: "DoorDash" },
  { match: "grubhub", category: "Dining Out", cleanName: "Grubhub" },
  { match: "instacart", category: "Groceries", cleanName: "Instacart" },
  { match: "uber", category: "Auto/Transport", cleanName: "Uber" },
  { match: "lyft", category: "Auto/Transport", cleanName: "Lyft" },
  { match: "shell oil", category: "Gas", cleanName: "Shell" },
  { match: "exxon", category: "Gas", cleanName: "Exxon" },
  { match: "mobil", category: "Gas", cleanName: "Mobil" },
  { match: "chevron", category: "Gas", cleanName: "Chevron" },
  { match: "bp ", category: "Gas", cleanName: "BP" },
  { match: "speedway", category: "Gas", cleanName: "Speedway" },
  { match: "stewart's", category: "Gas", cleanName: "Stewart's Shop" },
  { match: "stewarts shop", category: "Gas", cleanName: "Stewart's Shop" },
  { match: "sunoco", category: "Gas", cleanName: "Sunoco" },
  { match: "ezpass", category: "Auto/Transport", cleanName: "EZ-Pass" },
  { match: "e-zpass", category: "Auto/Transport", cleanName: "EZ-Pass" },
  { match: "thruway", category: "Auto/Transport", cleanName: "NYS Thruway" },
  { match: "parking", category: "Auto/Transport" },

  // ===== Groceries =====
  { match: "wegmans", category: "Groceries", cleanName: "Wegmans" },
  { match: "tops markets", category: "Groceries", cleanName: "Tops" },
  { match: "tops friendly", category: "Groceries", cleanName: "Tops" },
  { match: "price chopper", category: "Groceries", cleanName: "Price Chopper" },
  { match: "trader joe", category: "Groceries", cleanName: "Trader Joe's" },
  { match: "whole foods", category: "Groceries", cleanName: "Whole Foods" },
  { match: "aldi", category: "Groceries", cleanName: "Aldi" },
  { match: "costco", category: "Groceries", cleanName: "Costco" },
  { match: "bj's wholesale", category: "Groceries", cleanName: "BJ's Wholesale" },
  { match: "sam's club", category: "Groceries", cleanName: "Sam's Club" },
  { match: "walmart grocery", category: "Groceries", cleanName: "Walmart Grocery" },

  // ===== Food & Dining =====
  { match: "starbucks", category: "Coffee", cleanName: "Starbucks" },
  { match: "dunkin", category: "Coffee", cleanName: "Dunkin'" },
  { match: "mcdonald", category: "Dining Out", cleanName: "McDonald's" },
  { match: "chick-fil-a", category: "Dining Out", cleanName: "Chick-fil-A" },
  { match: "chipotle", category: "Dining Out", cleanName: "Chipotle" },
  { match: "panera", category: "Dining Out", cleanName: "Panera Bread" },
  { match: "subway", category: "Dining Out", cleanName: "Subway" },
  { match: "domino", category: "Dining Out", cleanName: "Domino's" },
  { match: "papa john", category: "Dining Out", cleanName: "Papa John's" },
  { match: "pizza hut", category: "Dining Out", cleanName: "Pizza Hut" },
  { match: "taco bell", category: "Dining Out", cleanName: "Taco Bell" },
  { match: "wendy", category: "Dining Out", cleanName: "Wendy's" },
  { match: "burger king", category: "Dining Out", cleanName: "Burger King" },
  { match: "five guys", category: "Dining Out", cleanName: "Five Guys" },
  { match: "olive garden", category: "Dining Out", cleanName: "Olive Garden" },
  { match: "cheesecake factory", category: "Dining Out", cleanName: "Cheesecake Factory" },
  { match: "sp compass", category: "Dining Out" },     // SP COMPASS = Compass Group cafeteria
  { match: "marriott", category: "Travel", cleanName: "Marriott" },

  // ===== Utilities =====
  { match: "verizon", category: "Utilities", cleanName: "Verizon" },
  { match: "at&t", category: "Utilities", cleanName: "AT&T" },
  { match: "att*bill", category: "Utilities", cleanName: "AT&T" },
  { match: "t-mobile", category: "Utilities", cleanName: "T-Mobile" },
  { match: "tmobile", category: "Utilities", cleanName: "T-Mobile" },
  { match: "spectrum", category: "Utilities", cleanName: "Spectrum" },
  { match: "xfinity", category: "Utilities", cleanName: "Xfinity" },
  { match: "comcast", category: "Utilities", cleanName: "Comcast" },
  { match: "national grid", category: "Utilities", cleanName: "National Grid" },
  { match: "nyseg", category: "Utilities", cleanName: "NYSEG" },
  { match: "rg&e", category: "Utilities", cleanName: "RG&E" },
  { match: "con edison", category: "Utilities", cleanName: "Con Edison" },
  { match: "duke energy", category: "Utilities", cleanName: "Duke Energy" },
  { match: "water authority", category: "Utilities" },
  { match: "waste management", category: "Utilities", cleanName: "Waste Management" },

  // ===== Subscriptions =====
  { match: "netflix", category: "Subscriptions", cleanName: "Netflix" },
  { match: "spotify", category: "Subscriptions", cleanName: "Spotify" },
  { match: "hulu", category: "Subscriptions", cleanName: "Hulu" },
  { match: "disney plus", category: "Subscriptions", cleanName: "Disney+" },
  { match: "disney+", category: "Subscriptions", cleanName: "Disney+" },
  { match: "hbo max", category: "Subscriptions", cleanName: "HBO Max" },
  { match: "apple.com/bill", category: "Subscriptions", cleanName: "Apple" },
  { match: "icloud", category: "Subscriptions", cleanName: "iCloud" },
  { match: "google storage", category: "Subscriptions", cleanName: "Google Storage" },
  { match: "google*google one", category: "Subscriptions", cleanName: "Google One" },
  { match: "youtube premium", category: "Subscriptions", cleanName: "YouTube Premium" },
  { match: "adobe", category: "Subscriptions", cleanName: "Adobe" },
  { match: "microsoft 365", category: "Subscriptions", cleanName: "Microsoft 365" },
  { match: "openai", category: "Subscriptions", cleanName: "OpenAI" },
  { match: "chatgpt", category: "Subscriptions", cleanName: "ChatGPT" },
  { match: "perplexity", category: "Subscriptions", cleanName: "Perplexity" },
  { match: "anthropic", category: "Subscriptions", cleanName: "Anthropic" },
  { match: "github", category: "Subscriptions", cleanName: "GitHub" },
  { match: "google*ads", category: "Other", cleanName: "Google Ads" },

  // ===== Shopping =====
  { match: "amazon markeplace", category: "Shopping", cleanName: "Amazon Marketplace" },  // typo in user CSV
  { match: "amazon marketplace", category: "Shopping", cleanName: "Amazon Marketplace" },
  { match: "amazon prime", category: "Subscriptions", cleanName: "Amazon Prime" },
  { match: "amzn mktp", category: "Shopping", cleanName: "Amazon" },
  { match: "amazon", category: "Shopping", cleanName: "Amazon" },
  { match: "target", category: "Shopping", cleanName: "Target" },
  { match: "walmart", category: "Shopping", cleanName: "Walmart" },
  { match: "best buy", category: "Shopping", cleanName: "Best Buy" },
  { match: "home depot", category: "Home Maintenance", cleanName: "Home Depot" },
  { match: "lowes", category: "Home Maintenance", cleanName: "Lowe's" },
  { match: "lowe's", category: "Home Maintenance", cleanName: "Lowe's" },
  { match: "ikea", category: "Home Maintenance", cleanName: "IKEA" },
  { match: "wayfair", category: "Home Maintenance", cleanName: "Wayfair" },
  { match: "ebay", category: "Shopping", cleanName: "eBay" },
  { match: "etsy", category: "Shopping", cleanName: "Etsy" },

  // ===== Health =====
  { match: "cvs", category: "Healthcare", cleanName: "CVS" },
  { match: "walgreens", category: "Healthcare", cleanName: "Walgreens" },
  { match: "rite aid", category: "Healthcare", cleanName: "Rite Aid" },
  { match: "original eyewear", category: "Healthcare" },
  { match: "lenscrafters", category: "Healthcare", cleanName: "LensCrafters" },
  { match: "warby parker", category: "Healthcare", cleanName: "Warby Parker" },
  { match: "cigna", category: "Healthcare", cleanName: "Cigna" },
  { match: "aetna", category: "Healthcare", cleanName: "Aetna" },
  { match: "blue cross", category: "Healthcare", cleanName: "Blue Cross" },

  // ===== Travel =====
  { match: "airbnb", category: "Travel", cleanName: "Airbnb" },
  { match: "vrbo", category: "Travel", cleanName: "VRBO" },
  { match: "hilton", category: "Travel", cleanName: "Hilton" },
  { match: "hyatt", category: "Travel", cleanName: "Hyatt" },
  { match: "delta air", category: "Travel", cleanName: "Delta" },
  { match: "american airlines", category: "Travel", cleanName: "American Airlines" },
  { match: "united airlines", category: "Travel", cleanName: "United Airlines" },
  { match: "southwest air", category: "Travel", cleanName: "Southwest" },
  { match: "jetblue", category: "Travel", cleanName: "JetBlue" },
  { match: "expedia", category: "Travel", cleanName: "Expedia" },
  { match: "booking.com", category: "Travel", cleanName: "Booking.com" },

  // ===== Income =====
  { match: "direct deposit", category: "Salary" },
  { match: "payroll", category: "Salary" },
  { match: "interest paid", category: "Interest" },
  { match: "interest earned", category: "Interest" },
  { match: "refund", category: "Refunds" },
  { match: "venmo cashout", category: "Other Income" },

  // ===== Transfers (skip categorizing) - handled separately =====
  { match: "zelle", category: "Transfers" },
  { match: "venmo", category: "Transfers" },
  { match: "cash app", category: "Transfers" },
  { match: "online transfer", category: "Transfers" },

  // ===== Fees =====
  { match: "rewards point reinstatement", category: "Bank Fees" },
  { match: "annual fee", category: "Bank Fees" },
  { match: "late fee", category: "Bank Fees" },
  { match: "interest charge", category: "Bank Fees" },
  { match: "foreign transaction", category: "Bank Fees" },

  // ===== Credit reporting =====
  { match: "experian", category: "Subscriptions", cleanName: "Experian" },
  { match: "credit karma", category: "Subscriptions", cleanName: "Credit Karma" },

  // ===== Payments / payment processors =====
  { match: "online payment", category: "Transfers" },
  { match: "thank you for your payment", category: "Transfers" },
  { match: "paypal", category: "Other", cleanName: "PayPal" },
  { match: "apple cash", category: "Transfers", cleanName: "Apple Cash" },
  { match: "applpay", category: "Other" },

  // ===== Tools / SaaS =====
  { match: "docusign", category: "Subscriptions", cleanName: "DocuSign" },
  { match: "railway", category: "Subscriptions", cleanName: "Railway" },
  { match: "when i work", category: "Subscriptions", cleanName: "When I Work" },
  { match: "indeed jobs", category: "Other", cleanName: "Indeed" },
  { match: "onstar", category: "Auto/Transport", cleanName: "OnStar" },
  { match: "encircle", category: "Subscriptions", cleanName: "Encircle" },

  // ===== Travel additions =====
  { match: "airport", category: "Travel" },
  { match: "qantas", category: "Travel", cleanName: "Qantas" },

  // ===== Shopping / clothing =====
  { match: "lululemon", category: "Clothing", cleanName: "Lululemon" },
  { match: "temu", category: "Shopping", cleanName: "Temu" },
  { match: "regal cinema", category: "Entertainment", cleanName: "Regal Cinemas" },

  // ===== Pets =====
  { match: "chewy", category: "Other", cleanName: "Chewy" },
  { match: "petco", category: "Other", cleanName: "Petco" },
  { match: "petsmart", category: "Other", cleanName: "PetSmart" },
  { match: "dog doody", category: "Other" },
];

export interface MerchantSuggestion {
  category: string | null;
  cleanName: string | null;
}

export function suggestMerchant(description: string, merchant: string | null = null): MerchantSuggestion {
  const text = `${description} ${merchant || ""}`.toLowerCase();
  for (const p of MERCHANT_PATTERNS) {
    if (text.includes(p.match)) {
      return { category: p.category, cleanName: p.cleanName || null };
    }
  }
  return { category: null, cleanName: null };
}
