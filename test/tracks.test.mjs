// Run: node --test test/
import test from "node:test";
import assert from "node:assert/strict";
import { tracksOf } from "../lib/tracks.js";

const has = (title, company, id, category = "") => assert.ok(tracksOf(title, company, category).includes(id), `${title} @ ${company} should be ${id}, got ${tracksOf(title, company, category)}`);
const not = (title, company, id, category = "") => assert.ok(!tracksOf(title, company, category).includes(id), `${title} @ ${company} should not be ${id}, got ${tracksOf(title, company, category)}`);

test("investment banking", () => {
  has("2028 Investment Banking Analyst - Technology, Media & Telecom", "Goldman Sachs", "ib");
  has("Summer Analyst, M&A", "Lazard", "ib");
  has("Healthcare Banking Summer Associate", "Jefferies", "ib");
  has("Financial Advisory Analyst", "Houlihan Lokey", "ib");
  has("Analyst", "Evercore", "ib"); // generic title at a boutique
  not("Software Engineer", "Goldman Sachs", "ib");
});

test("equity research", () => {
  has("Equity Research Associate - Software", "Piper Sandler", "er");
  has("Research Analyst, Investment Research", "Morningstar", "er");
  not("UX Research Analyst", "Stripe", "er");
  not("Clinical Research Associate", "Pfizer", "er");
});

test("private and alternative credit", () => {
  has("Private Credit Analyst", "Ares Management", "privcredit");
  has("Direct Lending Associate", "Golub Capital", "privcredit");
  has("Credit Analyst", "Blue Owl", "privcredit");
  has("Asset-Based Finance Associate", "Apollo", "altcredit");
  has("Structured Credit Analyst", "Oaktree", "altcredit");
  has("Special Situations Associate", "Sixth Street", "altcredit");
  not("Software Engineer", "Ares Management", "privcredit");
});

test("alternative investments", () => {
  has("Private Equity Associate", "Warburg Pincus", "altinv");
  has("Hedge Fund Analyst", "Point72", "altinv");
  has("Investment Analyst", "Hamilton Lane", "altinv");
  has("Analyst, Alternative Investments", "Cresset", "altinv");
  has("Associate", "Blackstone", "altinv");
});

test("sales and trading and quant", () => {
  has("Sales & Trading Summer Analyst", "Truist Securities", "st");
  has("Rates Trading Analyst", "Citi", "st");
  has("Global Markets Analyst", "Barclays", "st");
  has("Securities Division Strat", "Goldman Sachs", "st");
  has("Quantitative Trader", "Jane Street", "quant");
  has("Quantitative Researcher", "Two Sigma", "quant");
  has("Trader", "Optiver", "quant");
  has("Quant Developer", "Hudson River Trading", "quant");
  not("Sales Executive", "Acme Fleet", "st");
});

test("data and product", () => {
  has("Data Scientist, Growth", "Airbnb", "datasci");
  has("Machine Learning Engineer", "Scale AI", "datasci");
  has("Data Engineer II", "Capital One", "dataeng");
  has("Analytics Engineer", "Ramp", "dataeng");
  has("Data Analyst", "Polymarket", "dataan");
  has("Business Intelligence Analyst", "Kroger", "dataan");
  not("Data Engineer", "Capital One", "dataan");
  has("Associate Product Manager", "Google", "pm");
  has("Technical Product Manager, Platform", "Stripe", "tpm");
  has("Technical Product Manager, Platform", "Stripe", "pm");
  has("Product Manager, Data Platform", "Snowflake", "tpm");
  has("Product Strategy & Operations Associate", "Meta", "prodstrat");
  has("Strategy & Operations Analyst", "Uber", "prodstrat");
  not("Project Manager", "Turner Construction", "pm");
  not("Senior Software Engineer", "Stripe", "datasci");
});

test("corporate finance", () => {
  has("Financial Analyst", "CRH", "finance");
  has("FP&A Analyst", "Ibotta", "finance");
  has("Treasury Analyst", "Home Depot", "finance");
  has("Strategic Finance Associate", "Ramp", "finance");
  not("Staff Accountant", "Acme", "finance");
  not("Software Engineer", "Goldman Sachs", "finance");
});
