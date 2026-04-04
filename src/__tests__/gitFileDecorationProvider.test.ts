import * as assert from "node:assert"
import { suite, test } from "mocha"
import { Uri } from "vscode"
import { GitFileDecorationProvider } from "../views/gitFileDecorationProvider"
import { FILE_NODE_URI_SCHEME } from "../views/nodes"

function makeFileNodeUri(status: string, filePath = "src/file.ts"): Uri {
  return Uri.from({
    scheme: FILE_NODE_URI_SCHEME,
    path: `/${filePath}`,
    query: `status=${status}`,
  })
}

suite("GitFileDecorationProvider", () => {
  let provider: GitFileDecorationProvider

  setup(() => {
    provider = new GitFileDecorationProvider()
  })

  teardown(() => {
    provider.dispose()
  })

  suite("provideFileDecoration - wrong scheme", () => {
    test("should return undefined for a file:// URI", () => {
      const uri = Uri.file("/repo/src/file.ts")
      const decoration = provider.provideFileDecoration(uri)
      assert.strictEqual(decoration, undefined)
    })

    test("should return undefined for a gitless-revision URI", () => {
      const uri = Uri.from({
        scheme: "gitless-revision",
        path: "/src/file.ts",
        query: "status=modified",
      })
      const decoration = provider.provideFileDecoration(uri)
      assert.strictEqual(decoration, undefined)
    })

    test("should return undefined when status query param is missing", () => {
      const uri = Uri.from({
        scheme: FILE_NODE_URI_SCHEME,
        path: "/src/file.ts",
      })
      const decoration = provider.provideFileDecoration(uri)
      assert.strictEqual(decoration, undefined)
    })
  })

  suite("provideFileDecoration - added", () => {
    test("should return badge A", () => {
      const d = provider.provideFileDecoration(makeFileNodeUri("added"))
      assert.ok(d)
      assert.strictEqual((d as import("vscode").FileDecoration).badge, "A")
    })

    test("should return tooltip 'Added'", () => {
      const d = provider.provideFileDecoration(makeFileNodeUri("added"))
      assert.ok(d)
      assert.strictEqual(
        (d as import("vscode").FileDecoration).tooltip,
        "Added",
      )
    })

    test("should use gitDecoration.addedResourceForeground color", () => {
      const d = provider.provideFileDecoration(makeFileNodeUri("added"))
      assert.ok(d)
      const color = (d as import("vscode").FileDecoration).color as
        | import("vscode").ThemeColor
        | undefined
      assert.ok(color)
      assert.strictEqual(
        (color as { id: string }).id,
        "gitDecoration.addedResourceForeground",
      )
    })
  })

  suite("provideFileDecoration - modified", () => {
    test("should return badge M", () => {
      const d = provider.provideFileDecoration(makeFileNodeUri("modified"))
      assert.ok(d)
      assert.strictEqual((d as import("vscode").FileDecoration).badge, "M")
    })

    test("should return tooltip 'Modified'", () => {
      const d = provider.provideFileDecoration(makeFileNodeUri("modified"))
      assert.ok(d)
      assert.strictEqual(
        (d as import("vscode").FileDecoration).tooltip,
        "Modified",
      )
    })

    test("should use gitDecoration.modifiedResourceForeground color", () => {
      const d = provider.provideFileDecoration(makeFileNodeUri("modified"))
      assert.ok(d)
      const color = (d as import("vscode").FileDecoration).color as
        | import("vscode").ThemeColor
        | undefined
      assert.ok(color)
      assert.strictEqual(
        (color as { id: string }).id,
        "gitDecoration.modifiedResourceForeground",
      )
    })
  })

  suite("provideFileDecoration - deleted", () => {
    test("should return badge D", () => {
      const d = provider.provideFileDecoration(makeFileNodeUri("deleted"))
      assert.ok(d)
      assert.strictEqual((d as import("vscode").FileDecoration).badge, "D")
    })

    test("should return tooltip 'Deleted'", () => {
      const d = provider.provideFileDecoration(makeFileNodeUri("deleted"))
      assert.ok(d)
      assert.strictEqual(
        (d as import("vscode").FileDecoration).tooltip,
        "Deleted",
      )
    })

    test("should use gitDecoration.deletedResourceForeground color", () => {
      const d = provider.provideFileDecoration(makeFileNodeUri("deleted"))
      assert.ok(d)
      const color = (d as import("vscode").FileDecoration).color as
        | import("vscode").ThemeColor
        | undefined
      assert.ok(color)
      assert.strictEqual(
        (color as { id: string }).id,
        "gitDecoration.deletedResourceForeground",
      )
    })
  })

  suite("provideFileDecoration - renamed", () => {
    test("should return badge R", () => {
      const d = provider.provideFileDecoration(makeFileNodeUri("renamed"))
      assert.ok(d)
      assert.strictEqual((d as import("vscode").FileDecoration).badge, "R")
    })

    test("should return tooltip 'Renamed'", () => {
      const d = provider.provideFileDecoration(makeFileNodeUri("renamed"))
      assert.ok(d)
      assert.strictEqual(
        (d as import("vscode").FileDecoration).tooltip,
        "Renamed",
      )
    })

    test("should use gitDecoration.renamedResourceForeground color", () => {
      const d = provider.provideFileDecoration(makeFileNodeUri("renamed"))
      assert.ok(d)
      const color = (d as import("vscode").FileDecoration).color as
        | import("vscode").ThemeColor
        | undefined
      assert.ok(color)
      assert.strictEqual(
        (color as { id: string }).id,
        "gitDecoration.renamedResourceForeground",
      )
    })
  })

  suite("provideFileDecoration - copied", () => {
    test("should return badge C", () => {
      const d = provider.provideFileDecoration(makeFileNodeUri("copied"))
      assert.ok(d)
      assert.strictEqual((d as import("vscode").FileDecoration).badge, "C")
    })

    test("should return tooltip 'Copied'", () => {
      const d = provider.provideFileDecoration(makeFileNodeUri("copied"))
      assert.ok(d)
      assert.strictEqual(
        (d as import("vscode").FileDecoration).tooltip,
        "Copied",
      )
    })

    test("should use gitDecoration.addedResourceForeground color", () => {
      const d = provider.provideFileDecoration(makeFileNodeUri("copied"))
      assert.ok(d)
      const color = (d as import("vscode").FileDecoration).color as
        | import("vscode").ThemeColor
        | undefined
      assert.ok(color)
      assert.strictEqual(
        (color as { id: string }).id,
        "gitDecoration.addedResourceForeground",
      )
    })
  })

  suite("provideFileDecoration - untracked", () => {
    test("should return badge U", () => {
      const d = provider.provideFileDecoration(makeFileNodeUri("untracked"))
      assert.ok(d)
      assert.strictEqual((d as import("vscode").FileDecoration).badge, "U")
    })

    test("should return tooltip 'Untracked'", () => {
      const d = provider.provideFileDecoration(makeFileNodeUri("untracked"))
      assert.ok(d)
      assert.strictEqual(
        (d as import("vscode").FileDecoration).tooltip,
        "Untracked",
      )
    })

    test("should use gitDecoration.untrackedResourceForeground color", () => {
      const d = provider.provideFileDecoration(makeFileNodeUri("untracked"))
      assert.ok(d)
      const color = (d as import("vscode").FileDecoration).color as
        | import("vscode").ThemeColor
        | undefined
      assert.ok(color)
      assert.strictEqual(
        (color as { id: string }).id,
        "gitDecoration.untrackedResourceForeground",
      )
    })
  })

  suite("provideFileDecoration - file path in URI", () => {
    test("should handle filenames with extensions correctly", () => {
      const uri = makeFileNodeUri("modified", "package.json")
      const d = provider.provideFileDecoration(uri)
      assert.ok(d)
      assert.strictEqual((d as import("vscode").FileDecoration).badge, "M")
    })

    test("should handle nested paths correctly", () => {
      const uri = makeFileNodeUri("added", "src/components/Button.tsx")
      const d = provider.provideFileDecoration(uri)
      assert.ok(d)
      assert.strictEqual((d as import("vscode").FileDecoration).badge, "A")
    })
  })
})
