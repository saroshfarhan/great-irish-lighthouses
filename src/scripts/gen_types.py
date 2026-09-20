"""Generate TypeScript types from the pydantic models.

The schema has exactly one source: the pydantic models in `build_dataset.py`. This
script derives `src/data/schema.gen.ts` from them so the app's types cannot drift from
the pipeline's output. Change a field in `build_dataset.py`, re-run, and the TypeScript
follows.

Emitted by hand rather than via json-schema-to-typescript because the model set is
small and fixed, and this avoids a Node dependency inside the Python pipeline.

    uv run src/scripts/gen_types.py
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

from build_dataset import Arc, Band, LightCharacter, Lighthouse, LightRange, Position, Tower

OUT_FILE = Path(__file__).parent.parent / "data" / "schema.gen.ts"

MODELS = [Position, LightCharacter, LightRange, Arc, Band, Tower, Lighthouse]

# pydantic JSON-Schema primitives -> TypeScript
PRIMITIVES = {
    "string": "string",
    "number": "number",
    "integer": "number",
    "boolean": "boolean",
}


def ts_type(schema: dict[str, Any]) -> str:
    if "$ref" in schema:
        return schema["$ref"].rsplit("/", 1)[-1]

    if "anyOf" in schema:
        parts = [ts_type(s) for s in schema["anyOf"]]
        # pydantic renders `X | None` as anyOf[X, null]
        parts = [p for p in parts if p != "null"] + (["null"] if "null" in parts else [])
        return " | ".join(dict.fromkeys(parts))

    kind = schema.get("type")
    if kind == "array":
        return f"{ts_type(schema.get('items', {}))}[]"
    if kind == "object":
        extra = schema.get("additionalProperties")
        return (
            f"Record<string, {ts_type(extra)}>"
            if isinstance(extra, dict)
            else "Record<string, unknown>"
        )
    if kind == "null":
        return "null"
    return PRIMITIVES.get(kind, "unknown")


def emit_interface(model: type) -> str:
    schema = model.model_json_schema(ref_template="#/$defs/{model}")
    required = set(schema.get("required", []))
    lines: list[str] = []

    if doc := (model.__doc__ or "").strip():
        summary = doc.split("\n\n")[0].replace("\n", " ").strip()
        lines.append(f"/** {' '.join(summary.split())} */")

    lines.append(f"export interface {model.__name__} {{")
    for name, prop in schema.get("properties", {}).items():
        optional = "" if name in required else "?"
        if description := prop.get("description"):
            lines.append(f"  /** {' '.join(description.split())} */")
        lines.append(f"  {name}{optional}: {ts_type(prop)};")
    lines.append("}")
    return "\n".join(lines)


def main() -> int:
    try:
        revision = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        revision = "unversioned"

    body = "\n\n".join(emit_interface(m) for m in MODELS)

    header = f"""// GENERATED FILE — DO NOT EDIT.
//
// Produced by src/scripts/gen_types.py from the pydantic models in build_dataset.py,
// which are the single source of truth for the dataset's shape. To change a field,
// edit the model and re-run:
//
//     uv run src/scripts/gen_types.py
//
// Pipeline revision at generation: {revision}
"""

    footer = """

/** The shipped dataset: src/data/lighthouses.json */
export type LighthouseDataset = Lighthouse[];

/** Lazily fetched prose, keyed by lighthouse id: src/data/histories.json */
export type HistoryIndex = Record<string, string>;
"""

    OUT_FILE.write_text(header + "\n" + body + footer, encoding="utf-8")
    print(f"wrote {len(MODELS)} interfaces -> {OUT_FILE}")

    # Sanity check: the generated shape should cover every key actually emitted.
    data_file = OUT_FILE.parent / "lighthouses.json"
    if data_file.exists():
        data = json.loads(data_file.read_text(encoding="utf-8"))
        declared = set(Lighthouse.model_json_schema()["properties"])
        actual = {k for row in data for k in row}
        if missing := actual - declared:
            print(f"  WARNING: data has keys absent from the schema: {sorted(missing)}")
            return 1
        print(f"  verified against {len(data)} records — no undeclared keys")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
