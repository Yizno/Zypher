import type { ImportedFontAsset } from "../../../shared/types";

const loadedFontFaces = new Map<string, { signature: string; fontFace: FontFace }>();

function buildFontFaceSource(asset: ImportedFontAsset): string {
  return `url("${asset.fileUrl}") format("${asset.format}")`;
}

export async function syncImportedFontFaces(assets: ImportedFontAsset[]): Promise<void> {
  const nextIds = new Set(assets.map((asset) => asset.id));
  for (const [fontId, loaded] of loadedFontFaces) {
    if (nextIds.has(fontId)) {
      continue;
    }

    document.fonts.delete(loaded.fontFace);
    loadedFontFaces.delete(fontId);
  }

  for (const asset of assets) {
    const signature = `${asset.family}|${asset.fileUrl}|${asset.format}`;
    const current = loadedFontFaces.get(asset.id);
    if (current?.signature === signature) {
      continue;
    }

    if (current) {
      document.fonts.delete(current.fontFace);
      loadedFontFaces.delete(asset.id);
    }

    const fontFace = new FontFace(asset.family, buildFontFaceSource(asset));
    await fontFace.load();
    document.fonts.add(fontFace);
    loadedFontFaces.set(asset.id, { signature, fontFace });
  }
}
