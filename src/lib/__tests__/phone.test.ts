import { describe, expect, it } from "vitest";
import { isValidIndianMobile, normalizeMobile, suspiciousMobileReason, maskMobile } from "../phone";

describe("normalizeMobile", () => {
  it("strips +91, 0 and spaces", () => {
    expect(normalizeMobile("+91 98290 12345")).toBe("9829012345");
    expect(normalizeMobile("09829012345")).toBe("9829012345");
  });
});

describe("isValidIndianMobile", () => {
  it("accepts 6-9 starting 10 digit numbers", () => {
    expect(isValidIndianMobile("9829012345")).toBe(true);
    expect(isValidIndianMobile("5829012345")).toBe(false);
    expect(isValidIndianMobile("98290")).toBe(false);
  });
});

describe("suspiciousMobileReason (Smart OTP)", () => {
  it("flags fake-looking numbers", () => {
    expect(suspiciousMobileReason("9999999999")).toBe("too_few_digits");
    expect(suspiciousMobileReason("9000000000")).toBe("too_few_digits");
    expect(suspiciousMobileReason("9876543210")).toBe("sequence");
    expect(suspiciousMobileReason("6789012345")).toBe("sequence");
    expect(suspiciousMobileReason("9812398123")).toBe("repeating_half");
    expect(suspiciousMobileReason("9898989898")).toBe("too_few_digits");
    expect(suspiciousMobileReason("9811111113")).toBe("long_run");
  });
  it("lets normal numbers through", () => {
    expect(suspiciousMobileReason("9829012345")).toBeNull();
    expect(suspiciousMobileReason("7014563829")).toBeNull();
  });
  it("marks invalid numbers", () => {
    expect(suspiciousMobileReason("12345")).toBe("invalid");
  });
});

describe("maskMobile", () => {
  it("keeps first 2 and last 3", () => expect(maskMobile("9829012345")).toBe("98xxxxx345"));
});
