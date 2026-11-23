import { describe, expect, it } from "vitest";
import { isValidUtr, upiLink } from "../upi";

describe("upiLink", () => {
  it("builds an NPCI pay link", () => {
    const l = upiLink({ vpa: "ramesh@okhdfc", payee: "Ramesh Sharma", amountRupees: 501, note: "Shagun O-0001" });
    expect(l).toBe("upi://pay?pa=ramesh%40okhdfc&pn=Ramesh%20Sharma&am=501.00&cu=INR&tn=Shagun%20O-0001");
  });
});

describe("isValidUtr", () => {
  it("UPI needs 12 digits", () => {
    expect(isValidUtr("412345678901", "direct_upi")).toBe(true);
    expect(isValidUtr("41234567890", "direct_upi")).toBe(false);
  });
  it("bank allows 8-22 alphanumerics", () => {
    expect(isValidUtr("HDFCR52026112312345", "bank_transfer")).toBe(true);
    expect(isValidUtr("abc", "bank_transfer")).toBe(false);
  });
});
