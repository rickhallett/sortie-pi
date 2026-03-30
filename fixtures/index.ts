import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

const FIXTURES_DIR = import.meta.dir;

export function loadFixture<T = unknown>(relativePath: string): T {
  const fullPath = join(FIXTURES_DIR, relativePath);
  const raw = readFileSync(fullPath, "utf-8");
  return parse(raw) as T;
}
