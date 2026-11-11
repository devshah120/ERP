/**
 * One-line descriptions shown under each listing's title. Kept in one place
 * so the copy stays consistent in tone across every module.
 */
export const MODULE_DESCRIPTIONS: Record<string, string> = {
  // masters
  customers: "Buyers you sell to — billing details, GSTIN, credit terms and opening balances.",
  vendors: "Suppliers you buy from, with their credit terms and opening balances.",
  agents: "Brokers and sales agents, with the commission rate applied to their business.",
  transporters: "Logistics partners and their transporter IDs for e-way bills.",
  items: "Products with garment attributes, pricing, tax and size/colour variants.",
  categories: "Product groupings. Categories can nest to form a hierarchy.",
  brands: "Labels your products are sold under.",
  units: "Units of measure and how many decimal places each allows.",
  warehouses: "Stock locations. Every stock movement is recorded against one.",
  branches: "Offices and locations that documents are raised from.",
  // sales
  "sales-quotations": "Price offers to customers. An approved quotation converts into a sales order.",
  "sales-orders": "Confirmed customer orders, tracked through delivery and invoicing.",
  "delivery-challans": "Goods dispatched to customers. Dispatching moves stock out of the warehouse.",
  "sales-invoices": "Tax invoices raised to customers. Posted invoices become receivables.",
  "sales-returns": "Goods coming back from customers. Receiving them moves stock back in.",
  "credit-notes": "Amounts credited back to customers against earlier invoices.",
  // purchase
  "purchase-orders": "Orders placed with suppliers, tracked through receipt and billing.",
  "goods-receipts": "Goods received from suppliers. Receiving moves stock into the warehouse.",
  "purchase-invoices": "Supplier bills. Posted bills become payables.",
  "purchase-returns": "Goods sent back to suppliers. Dispatching them moves stock out.",
  "debit-notes": "Amounts debited to suppliers against earlier bills.",
  // money
  receipts: "Money received from customers, allocated against their open invoices.",
  payments: "Money paid to suppliers, allocated against their open bills.",
  // item masters
  departments: "Store departments that products roll up to, such as Menswear or Kidswear.",
  "category-variants": "The size and colour range each category is normally stocked in. The item form offers it when generating variants.",
  "combo-products": "Bundles sold as one product, made up of other stocked items.",
  // sales & purchase setup
  "catalog-listings": "How products appear in the online store: title, URL, online price and whether they are published.",
  "price-lists": "Price rules mapped to categories, such as wholesale rates or a festive markdown.",
  "sales-terms": "Reusable terms & conditions for quotations, orders and invoices.",
  "purchase-terms": "Reusable terms & conditions for purchase orders and supplier documents.",
  // production
  "bill-of-materials": "The components that make up a finished product. Material Creation consumes them to produce it.",
  recipes: "Process formulas, such as dyes and chemicals per batch, that Material Creation can run.",
  // crm
  coupons: "Codes customers quote at the counter for money off. POS checks validity, minimum bill and usage limits.",
  memberships: "Customer membership cards and the discount each carries.",
  discounts: "Automatic markdowns on everything, a category, a brand or one product. POS applies them without a code.",
  "loyalty-programs": "How customers earn and redeem loyalty points.",
  feedback: "What customers told you, and whether it has been resolved.",
  // bank & setup
  "bank-accounts": "Your bank accounts and the ledger each one posts to. Reconciliation matches that ledger against the statement.",
  "tax-rates": "GST slabs in use, with cess and the HSN codes at each rate.",
  "payment-terms": "Named credit terms, such as Net 30, with optional early-payment discounts.",
  "additional-charges": "Freight, packing and other amounts added on top of goods value, with their GST rate.",
  devices: "Billing counters, tablets and scanners approved for this workspace.",
  targets: "Sales, collection and purchase goals for a period. The Target vs Actual report measures progress against them.",
};
