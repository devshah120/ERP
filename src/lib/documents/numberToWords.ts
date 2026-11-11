const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return TENS[t] + (o ? ` ${ONES[o]}` : "");
}

function threeDigits(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (h) parts.push(`${ONES[h]} Hundred`);
  if (rest) parts.push(twoDigits(rest));
  return parts.join(" ");
}

/**
 * Amount in words using the Indian numbering system (Crore / Lakh /
 * Thousand), which is what a GST invoice is expected to print.
 */
export function amountInWords(amount: string | number, currency = "Rupees"): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return "";

  const negative = value < 0;
  const abs = Math.abs(value);
  const whole = Math.floor(abs);
  // Round paise rather than truncate, so 0.005 doesn't silently vanish.
  const paise = Math.round((abs - whole) * 100);

  if (whole === 0 && paise === 0) return `${currency} Zero Only`;

  const crore = Math.floor(whole / 10000000);
  const lakh = Math.floor((whole % 10000000) / 100000);
  const thousand = Math.floor((whole % 100000) / 1000);
  const hundred = whole % 1000;

  const parts: string[] = [];
  if (crore) parts.push(`${threeDigits(crore)} Crore`);
  if (lakh) parts.push(`${threeDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${threeDigits(thousand)} Thousand`);
  if (hundred) parts.push(threeDigits(hundred));

  let words = parts.join(" ").trim();
  if (paise > 0) words += ` and ${twoDigits(paise)} Paise`;

  return `${negative ? "Minus " : ""}${currency} ${words} Only`;
}
