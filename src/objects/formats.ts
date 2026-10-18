// Kept apart from the loaders so the page can name the formats without loading the parsers
export const MODEL_EXT = ['glb', 'gltf', 'obj', 'stl', 'ply', 'fbx'] as const
export const ACCEPT = [...MODEL_EXT.map((e) => '.' + e), '.mtl', '.bin', '.png', '.jpg', '.jpeg', '.webp'].join(',')
