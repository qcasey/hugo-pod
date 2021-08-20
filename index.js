const { MarkdownExportPod, MarkdownPublishPod, ExportPod, PodUtils } = require("@dendronhq/pods-core");
const fs = require('fs-extra');
const path = require("path");
const {
  DNodeUtils,
  DVault,
  genUUID,
  NoteProps,
  NoteUtils,
  PodConfig,
  VaultUtils,
} = require("@dendronhq/common-all");
const yaml = require('js-yaml');
const { DendronASTDest, MDUtilsV4 } = require("@dendronhq/engine-server");

function dot2Slash(fname) {
  return fname.replace(/\.(?=[^.]*)/ig, "/");
}

function replaceAssetDirs(body) {
  let assetLinks = body.match(/(!\[.*\]\()assets/ig);

  if (assetLinks)
    assetLinks.forEach(link => {
      // Replace ![.*](assets with the hugo static dir (root)
      let newLink = link.replace("assets", "");

      body = body.replace(link, newLink);
    });
  return body;
}

function replacePortalsWithShortcodes(body) {
  let portals = body.match(/(!\[\[.+\]\])\s/ig);

  if (portals)
    portals.forEach(portal => {
      //console.log(`Replacing portal ${portal}`);

      // Replace ![[ ]] with a hugo shortcode
      // Quote ref
      let shortcode = portal.replace("![[", '{{< dendron/portal "').replace("]]", '" >}}').replace("#", '" "');

      //// for hugo replacePortalsWithShortcodes{{ ref }} ?
      //shortcode = dot2Slash(shortcode).replace("#", "/index.md #");
      body = body.replace(portal, shortcode);
    });
  return body;
}

function replaceRefsWithShortcodes(body) {
  let refs = body.match(/[^!](\[\[[^\[]+\]\])/ig);

  if (refs)
    refs.forEach(ref => {
      //console.log(`Replacing ref ${ref}`);
      let shortcode = ref;

      // Replace [[custom titles|for.page.refs]]
      const REF_TITLE_REGEX = /\[\[[^\[]+(\|)/ig;
      const linkName = ref.match(REF_TITLE_REGEX);
      if (linkName) {
        linkName.forEach(name => {
          //console.log(`Replacing named ref of ${name}`)
          let linkNameWithoutPipe = name.replace("|", '')//.replace('[[', '[[ "');
          shortcode = shortcode.replace(name, `${linkNameWithoutPipe}" "`);
        });
      }

      // Replace [[ ]] with a hugo shortcode
      shortcode = shortcode.replace("[[", '{{< dendron/ref "').replace("]]", '" >}}');
      body = body.replace(ref, shortcode);
    });
  return body;
}

class HugoExportPod extends ExportPod {
  static id = "hugo";
  static description = "Export markdown, leaving behind frontmatter and portal shortcodes.";

  get config() {
    return PodUtils.createExportConfig({
      required: ["fname", "vaultName", "includeStubs"],
      properties: {},
      additionalProperties: true,
    });
  }

  async plant(opts) {
    const { dest, notes } = opts;

    const ctx = "MarkdownExportPod:plant";
    // verify dest exist
    const podDstPath = dest.fsPath;
    fs.ensureDirSync(path.dirname(podDstPath));
    const mdPublishPod = new MarkdownPublishPod();

    //this.L.info({ ctx, msg: "pre:iterate_notes" });
    await Promise.all(
      notes.map(async (note) => {
        let { body, ...fmJson } = { ...note };
        let d = new Date(fmJson.created);
        fmJson.date = d.toISOString();
        fmJson = {...fmJson, ...fmJson.custom};
        const frontmatter = yaml.dump(fmJson, { noRefs: true });

        // Replace dendron content with hugo shortcodes
        note.body = replaceAssetDirs(replaceRefsWithShortcodes(replacePortalsWithShortcodes(note.body)));

        // Construct index body
        body = await mdPublishPod.plant({ ...opts, note });

        // Remove "# Title" that was inserted in plant
        body = body.replace(/\#(.+)/i, "")

        // Insert frontmatter
        body = `---\n${frontmatter}\n---\n\n${body}`;

        //const hpath = note.fname + ".md";
        const hpath = dot2Slash(note.fname);
        const vname = VaultUtils.getName(note.vault);
        let fpath = path.join(podDstPath, vname, hpath);
        fpath = !(note.children.length)
          ? fpath + ".md"
          : path.join(fpath, "_index.md");

        // Force root.md to be _index.md of garden
        // if (note.fname == "root")
        //   fpath = path.join(podDstPath, vname, "index.md");

        this.L.info({ ctx, fpath, msg: "pre:write" });
        await fs.ensureDir(path.dirname(fpath));
        return fs.writeFile(fpath, body);
      })
    );

    // Add _index.md to root folder, to ensure it matches the Hugo layout of lower leaf notes
    //await fs.writeFile(path.join(podDstPath, "_index.md"), "---\ntype: note\n---");

    return { notes };
  }
}

module.exports = {
  pods: [HugoExportPod],
};
