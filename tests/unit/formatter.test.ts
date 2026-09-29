import { describe, expect, it } from "vitest";
import { TerminalFormatter } from "../../src/presentation/formatter.js";

describe("Presentation: TerminalFormatter", () => {
  it("formats text correctly in non-color mode", () => {
    const formatter = new TerminalFormatter({ isTty: false, noColor: true });

    expect(formatter.bold("hello")).toBe("hello");
    expect(formatter.green("ok")).toBe("ok");
    expect(formatter.red("err")).toBe("err");
    expect(formatter.badge("PASS", "pass")).toBe("[PASS]");
    expect(formatter.metric("Metric", 42)).toContain("• Metric");
    expect(formatter.banner("Title")).toContain("Title");
  });

  it("formats text with colors when TTY is true and NO_COLOR is false", () => {
    const formatter = new TerminalFormatter({ isTty: true, noColor: false });

    expect(formatter.badge("PASS", "pass")).toContain("PASS");
    expect(formatter.badge("FAIL", "fail")).toContain("FAIL");
    expect(formatter.badge("SIM", "sim")).toContain("SIM");
    expect(formatter.badge("INFO", "info")).toContain("INFO");
  });
});

