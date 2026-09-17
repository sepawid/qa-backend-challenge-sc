import pc from "picocolors";

export interface FormatterOptions {
  readonly isTty?: boolean;
  readonly noColor?: boolean;
}

export class TerminalFormatter {
  private readonly useColor: boolean;

  constructor(options: FormatterOptions = {}) {
    const isTty = options.isTty ?? Boolean(process.stdout.isTTY);
    const noColor = options.noColor ?? Boolean(process.env["NO_COLOR"]);
    this.useColor = isTty && !noColor;
  }

  bold(text: string): string {
    return this.useColor ? pc.bold(text) : text;
  }

  green(text: string): string {
    return this.useColor ? pc.green(text) : text;
  }

  yellow(text: string): string {
    return this.useColor ? pc.yellow(text) : text;
  }

  red(text: string): string {
    return this.useColor ? pc.red(text) : text;
  }

  cyan(text: string): string {
    return this.useColor ? pc.cyan(text) : text;
  }

  dim(text: string): string {
    return this.useColor ? pc.dim(text) : text;
  }

  badge(label: string, style: "pass" | "fail" | "sim" | "info" = "info"): string {
    if (!this.useColor) return `[${label}]`;
    switch (style) {
      case "pass":
        return pc.bgGreen(pc.black(` ${label} `));
      case "fail":
        return pc.bgRed(pc.white(` ${label} `));
      case "sim":
        return pc.bgYellow(pc.black(` ${label} `));
      case "info":
        return pc.bgCyan(pc.black(` ${label} `));
    }
  }

  banner(title: string, subtitle?: string): string {
    const bar = "═".repeat(68);
    const lines = [
      this.cyan(bar),
      this.bold(`  ${title}`),
      ...(subtitle ? [this.dim(`  ${subtitle}`)] : []),
      this.cyan(bar),
    ];
    return lines.join("\n");
  }

  section(title: string): string {
    return `\n${this.bold(this.cyan(`─── ${title} `))}${"─".repeat(Math.max(2, 64 - title.length))}`;
  }

  metric(label: string, value: string | number, extra?: string): string {
    const padded = label.padEnd(30, " ");
    const valStr = this.bold(String(value));
    const extraStr = extra ? this.dim(` (${extra})`) : "";
    return `  • ${padded}: ${valStr}${extraStr}`;
  }

  box(content: string, type: "info" | "pass" | "sim" | "fail" = "info"): string {
    const lines = content.split("\n");
    const width = Math.max(...lines.map((l) => l.length), 50);
    const top = `┌${"─".repeat(width + 2)}┐`;
    const bottom = `└${"─".repeat(width + 2)}┘`;
    const formattedLines = lines.map((l) => `│ ${l.padEnd(width, " ")} │`);

    const result = [top, ...formattedLines, bottom].join("\n");
    switch (type) {
      case "pass":
        return this.green(result);
      case "fail":
        return this.red(result);
      case "sim":
        return this.yellow(result);
      case "info":
      default:
        return this.dim(result);
    }
  }
}
