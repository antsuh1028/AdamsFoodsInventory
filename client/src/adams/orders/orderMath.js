// What an order line asks for. A line wants cases, pounds, or both: exact cases
// AND at least the pounds. Estimates here are guides; real weights come from the boxes.

export const DAYS = ["MON", "TUES", "WED", "THUR", "FRI", "SAT"];

// The case weight a description names: "-30#" is 30 lb a case.
export const caseLb = (desc) => {
  const all = [...String(desc || "").matchAll(/(\d+(?:\.\d+)?)\s*#/g)];
  return all.length ? Number(all[all.length - 1][1]) : null;
};

export const casesOf = (l) => (Number(l.qtyCases) > 0 ? Number(l.qtyCases) : 0);
export const lbsOf = (l) => (Number(l.lbs) > 0 ? Number(l.lbs) : 0);
export const isOrdered = (l) => casesOf(l) > 0 || lbsOf(l) > 0;

// Pounds trimmed for reading: "40.000" is 40.
export const lbText = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? String(Math.round(n * 1000) / 1000) : "";
};

// Estimated pounds: what a line asks for, else cases times the case size.
export const lineLb = (l) => lbsOf(l) || (caseLb(l.description) || 0) * casesOf(l);

// Boxes a line will take, for the rows of tally grid it needs.
export const estCases = (l) => casesOf(l) || (caseLb(l.description) ? Math.ceil(lbsOf(l) / caseLb(l.description)) : 1);

// "3 cs + 40 lb": cases, plus pounds only from lines that ask for pounds alone.
export const wantText = (lines) => {
  const cs = lines.reduce((a, l) => a + casesOf(l), 0);
  const lb = lines.reduce((a, l) => a + (casesOf(l) ? 0 : lbsOf(l)), 0);
  return [cs ? `${cs} cs` : "", lb ? `${lb.toLocaleString()} lb` : ""].filter(Boolean).join(" + ") || "0 cs";
};

export const money = (n) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
