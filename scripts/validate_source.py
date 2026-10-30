"""Windows-capable source checks. This is NOT an Xcode build or a device test."""
from pathlib import Path
import json
import plistlib
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / ".tools"))
import yaml
from tree_sitter import Language, Parser
import tree_sitter_swift
from PIL import Image

parser = Parser(Language(tree_sitter_swift.language()))
failures = []
files = [ROOT / "Package.swift"]
for directory in ["App", "Sources", "Tests"]:
    files.extend((ROOT / directory).rglob("*.swift"))
for path in files:
    source = path.read_bytes()
    tree = parser.parse(source)
    def inspect(node):
        if node.is_error or node.is_missing:
            failures.append(f"{path.relative_to(ROOT)}:{node.start_point.row + 1}: Swift syntax {node.type}")
        for child in node.children:
            inspect(child)
    inspect(tree.root_node)
for path in (ROOT / "App").rglob("*.json"):
    json.loads(path.read_text(encoding="utf-8"))
for path in (ROOT / "App").rglob("*.xcprivacy"):
    plistlib.loads(path.read_bytes())
project = yaml.safe_load((ROOT / "project.yml").read_text())
workflow = yaml.safe_load((ROOT / ".github/workflows/ios.yml").read_text())
assert "workflow_dispatch" in workflow["on"]
assert workflow["permissions"]["contents"] == "read"
assert project["targets"]["SwitkoboRemote"]["dependencies"] == [{"package": "RemoteCore"}]
for target in project["targets"].values():
    for entry in target["sources"]:
        source_path = entry["path"] if isinstance(entry, dict) else entry
        assert (ROOT / source_path).exists(), source_path
props = project["targets"]["SwitkoboRemote"]["info"]["properties"]
for key in ["NSLocalNetworkUsageDescription", "NSMicrophoneUsageDescription", "NSSpeechRecognitionUsageDescription", "NSBonjourServices"]:
    assert props[key], key
assert "NSAllowsArbitraryLoads" not in props["NSAppTransportSecurity"]
with Image.open(ROOT / "App/Assets.xcassets/AppIcon.appiconset/AppIcon.png") as icon:
    assert icon.size == (1024, 1024) and icon.mode == "RGB"
if failures:
    print("\n".join(failures)); sys.exit(1)
print(f"PASS: parsed {len(files)} Swift files without syntax errors")
print("PASS: asset catalogs, privacy manifest, XcodeGen configuration, permissions, and build workflow structure")
print("Not performed: Swift typechecking, Xcode compilation, XCTest, native rendering, or Samsung hardware verification")
