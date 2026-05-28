/**
 * Block color mapping for Minecraft Bedrock Edition map rendering.
 * Colors match the in-game map item colors.
 * Format: [R, G, B]
 */
export const BLOCK_COLORS: Record<string, [number, number, number]> = {
  // Grass and vegetation
  'minecraft:grass_block': [127, 178, 56],
  'minecraft:grass': [127, 178, 56],
  'minecraft:tall_grass': [127, 178, 56],
  'minecraft:fern': [127, 178, 56],
  'minecraft:large_fern': [127, 178, 56],
  'minecraft:short_grass': [127, 178, 56],

  // Dirt variants
  'minecraft:dirt': [151, 109, 77],
  'minecraft:coarse_dirt': [151, 109, 77],
  'minecraft:farmland': [151, 109, 77],
  'minecraft:dirt_with_roots': [151, 109, 77],
  'minecraft:podzol': [151, 109, 77],
  'minecraft:mud': [120, 90, 60],
  'minecraft:muddy_mangrove_roots': [120, 90, 60],

  // Sand
  'minecraft:sand': [247, 233, 163],
  'minecraft:sandstone': [247, 233, 163],
  'minecraft:smooth_sandstone': [247, 233, 163],
  'minecraft:cut_sandstone': [247, 233, 163],
  'minecraft:chiseled_sandstone': [247, 233, 163],
  'minecraft:end_stone': [247, 233, 163],
  'minecraft:end_stone_bricks': [247, 233, 163],
  'minecraft:glowstone': [247, 233, 163],
  'minecraft:bone_block': [247, 233, 163],

  // Red sand
  'minecraft:red_sand': [199, 120, 51],
  'minecraft:red_sandstone': [199, 120, 51],

  // Stone variants
  'minecraft:stone': [136, 136, 136],
  'minecraft:cobblestone': [136, 136, 136],
  'minecraft:gravel': [136, 136, 136],
  'minecraft:andesite': [136, 136, 136],
  'minecraft:polished_andesite': [136, 136, 136],
  'minecraft:smooth_stone': [136, 136, 136],
  'minecraft:stone_bricks': [136, 136, 136],
  'minecraft:mossy_stone_bricks': [136, 136, 136],
  'minecraft:cracked_stone_bricks': [136, 136, 136],
  'minecraft:chiseled_stone_bricks': [136, 136, 136],
  'minecraft:bedrock': [60, 60, 60],

  // Deepslate
  'minecraft:deepslate': [100, 100, 100],
  'minecraft:cobbled_deepslate': [100, 100, 100],
  'minecraft:polished_deepslate': [100, 100, 100],
  'minecraft:deepslate_bricks': [100, 100, 100],
  'minecraft:deepslate_tiles': [100, 100, 100],

  // Water
  'minecraft:water': [63, 118, 228],
  'minecraft:flowing_water': [63, 118, 228],
  'minecraft:bubble_column': [63, 118, 228],

  // Lava
  'minecraft:lava': [207, 60, 24],
  'minecraft:flowing_lava': [207, 60, 24],
  'minecraft:magma': [207, 60, 24],

  // Snow and Ice
  'minecraft:snow': [255, 255, 255],
  'minecraft:snow_layer': [255, 255, 255],
  'minecraft:powder_snow': [255, 255, 255],
  'minecraft:ice': [160, 160, 255],
  'minecraft:packed_ice': [160, 160, 255],
  'minecraft:blue_ice': [100, 100, 220],
  'minecraft:frosted_ice': [160, 160, 255],

  // Wood - Oak/Birch (light)
  'minecraft:oak_planks': [199, 178, 124],
  'minecraft:birch_planks': [199, 178, 124],
  'minecraft:oak_log': [143, 119, 72],
  'minecraft:birch_log': [199, 178, 124],
  'minecraft:stripped_oak_log': [199, 178, 124],
  'minecraft:stripped_birch_log': [199, 178, 124],

  // Wood - Dark
  'minecraft:spruce_planks': [130, 102, 68],
  'minecraft:dark_oak_planks': [130, 102, 68],
  'minecraft:jungle_planks': [130, 102, 68],
  'minecraft:acacia_planks': [166, 94, 52],
  'minecraft:spruce_log': [130, 102, 68],
  'minecraft:dark_oak_log': [130, 102, 68],
  'minecraft:jungle_log': [130, 102, 68],
  'minecraft:acacia_log': [166, 94, 52],
  'minecraft:mangrove_log': [130, 102, 68],
  'minecraft:mangrove_planks': [130, 102, 68],
  'minecraft:cherry_log': [224, 168, 168],
  'minecraft:cherry_planks': [224, 168, 168],

  // Leaves
  'minecraft:oak_leaves': [0, 124, 0],
  'minecraft:birch_leaves': [0, 124, 0],
  'minecraft:spruce_leaves': [0, 124, 0],
  'minecraft:jungle_leaves': [0, 124, 0],
  'minecraft:dark_oak_leaves': [0, 124, 0],
  'minecraft:acacia_leaves': [0, 124, 0],
  'minecraft:azalea_leaves': [0, 124, 0],
  'minecraft:mangrove_leaves': [0, 124, 0],
  'minecraft:cherry_leaves': [224, 168, 168],

  // Ores
  'minecraft:coal_ore': [136, 136, 136],
  'minecraft:iron_ore': [136, 136, 136],
  'minecraft:gold_ore': [136, 136, 136],
  'minecraft:diamond_ore': [136, 136, 136],
  'minecraft:emerald_ore': [136, 136, 136],
  'minecraft:lapis_ore': [136, 136, 136],
  'minecraft:redstone_ore': [136, 136, 136],
  'minecraft:copper_ore': [136, 136, 136],

  // Metal blocks
  'minecraft:iron_block': [167, 167, 167],
  'minecraft:gold_block': [250, 238, 77],
  'minecraft:diamond_block': [92, 220, 209],
  'minecraft:emerald_block': [0, 217, 58],
  'minecraft:lapis_block': [74, 128, 255],
  'minecraft:coal_block': [24, 24, 24],
  'minecraft:copper_block': [192, 107, 79],
  'minecraft:netherite_block': [74, 58, 50],
  'minecraft:redstone_block': [255, 0, 0],

  // Nether blocks
  'minecraft:netherrack': [112, 41, 41],
  'minecraft:nether_bricks': [72, 36, 43],
  'minecraft:soul_sand': [84, 64, 51],
  'minecraft:soul_soil': [84, 64, 51],
  'minecraft:basalt': [72, 72, 72],
  'minecraft:polished_basalt': [72, 72, 72],
  'minecraft:smooth_basalt': [72, 72, 72],
  'minecraft:blackstone': [52, 44, 50],
  'minecraft:crimson_nylium': [189, 48, 49],
  'minecraft:warped_nylium': [22, 126, 134],
  'minecraft:crimson_stem': [148, 63, 97],
  'minecraft:warped_stem': [58, 142, 140],
  'minecraft:crimson_planks': [148, 63, 97],
  'minecraft:warped_planks': [58, 142, 140],
  'minecraft:shroomlight': [240, 146, 70],
  'minecraft:nether_wart_block': [163, 0, 0],
  'minecraft:warped_wart_block': [22, 126, 134],
  'minecraft:ancient_debris': [100, 75, 65],

  // Terracotta
  'minecraft:terracotta': [152, 94, 67],
  'minecraft:white_terracotta': [210, 178, 161],
  'minecraft:orange_terracotta': [162, 84, 38],
  'minecraft:magenta_terracotta': [150, 88, 109],
  'minecraft:light_blue_terracotta': [113, 109, 138],
  'minecraft:yellow_terracotta': [186, 133, 36],
  'minecraft:lime_terracotta': [103, 117, 53],
  'minecraft:pink_terracotta': [162, 78, 79],
  'minecraft:gray_terracotta': [58, 42, 36],
  'minecraft:light_gray_terracotta': [135, 107, 98],
  'minecraft:cyan_terracotta': [87, 92, 92],
  'minecraft:purple_terracotta': [118, 70, 86],
  'minecraft:blue_terracotta': [74, 60, 91],
  'minecraft:brown_terracotta': [77, 51, 36],
  'minecraft:green_terracotta': [76, 82, 42],
  'minecraft:red_terracotta': [143, 61, 47],
  'minecraft:black_terracotta': [37, 22, 16],

  // Concrete
  'minecraft:white_concrete': [207, 213, 214],
  'minecraft:orange_concrete': [224, 97, 1],
  'minecraft:magenta_concrete': [170, 48, 159],
  'minecraft:light_blue_concrete': [36, 137, 199],
  'minecraft:yellow_concrete': [241, 175, 21],
  'minecraft:lime_concrete': [94, 169, 24],
  'minecraft:pink_concrete': [214, 101, 143],
  'minecraft:gray_concrete': [55, 58, 62],
  'minecraft:light_gray_concrete': [125, 125, 115],
  'minecraft:cyan_concrete': [21, 119, 136],
  'minecraft:purple_concrete': [100, 32, 156],
  'minecraft:blue_concrete': [45, 47, 143],
  'minecraft:brown_concrete': [96, 60, 32],
  'minecraft:green_concrete': [73, 91, 36],
  'minecraft:red_concrete': [142, 33, 33],
  'minecraft:black_concrete': [8, 10, 15],

  // Wool
  'minecraft:white_wool': [234, 236, 236],
  'minecraft:orange_wool': [241, 118, 20],
  'minecraft:magenta_wool': [190, 68, 179],
  'minecraft:light_blue_wool': [58, 175, 217],
  'minecraft:yellow_wool': [249, 198, 40],
  'minecraft:lime_wool': [112, 185, 26],
  'minecraft:pink_wool': [238, 141, 172],
  'minecraft:gray_wool': [63, 68, 72],
  'minecraft:light_gray_wool': [142, 142, 135],
  'minecraft:cyan_wool': [21, 138, 145],
  'minecraft:purple_wool': [122, 42, 173],
  'minecraft:blue_wool': [53, 57, 157],
  'minecraft:brown_wool': [114, 72, 40],
  'minecraft:green_wool': [85, 110, 28],
  'minecraft:red_wool': [162, 38, 35],
  'minecraft:black_wool': [21, 21, 26],

  // Glass
  'minecraft:glass': [180, 220, 220],
  'minecraft:tinted_glass': [40, 30, 40],

  // Misc
  'minecraft:obsidian': [32, 26, 34],
  'minecraft:crying_obsidian': [32, 26, 34],
  'minecraft:clay': [162, 166, 182],
  'minecraft:prismarine': [75, 125, 105],
  'minecraft:dark_prismarine': [51, 91, 75],
  'minecraft:sea_lantern': [172, 199, 190],
  'minecraft:mycelium': [127, 103, 114],
  'minecraft:moss_block': [89, 148, 60],
  'minecraft:dripstone_block': [134, 107, 82],
  'minecraft:amethyst_block': [122, 75, 190],
  'minecraft:tuff': [108, 109, 102],
  'minecraft:calcite': [223, 224, 220],
  'minecraft:sculk': [12, 37, 42],
  'minecraft:hay_block': [166, 145, 15],
  'minecraft:melon_block': [111, 170, 48],
  'minecraft:pumpkin': [213, 125, 20],
  'minecraft:jack_o_lantern': [213, 125, 20],
  'minecraft:cactus': [0, 124, 0],
  'minecraft:bamboo_block': [166, 155, 66],
  'minecraft:bamboo_planks': [196, 179, 96],

  // Portals
  'minecraft:portal': [88, 0, 214],
  'minecraft:end_portal': [15, 15, 15],
  'minecraft:end_portal_frame': [88, 118, 82],

  // TNT
  'minecraft:tnt': [219, 68, 53],

  // Crafting/utility
  'minecraft:crafting_table': [130, 102, 68],
  'minecraft:furnace': [136, 136, 136],
  'minecraft:chest': [199, 178, 124],
  'minecraft:bookshelf': [130, 102, 68],
};

/**
 * Default color for unknown blocks (medium gray)
 */
export const DEFAULT_BLOCK_COLOR: [number, number, number] = [128, 128, 128];

/**
 * Transparent/air blocks that should be skipped in top-down rendering
 */
export const TRANSPARENT_BLOCKS = new Set([
  'minecraft:air',
  'minecraft:cave_air',
  'minecraft:void_air',
  'minecraft:barrier',
  'minecraft:light_block',
  'minecraft:structure_void',
]);

/**
 * Get the map color for a block
 */
export function getBlockColor(blockName: string): [number, number, number] {
  // Try exact match first
  if (BLOCK_COLORS[blockName]) {
    return BLOCK_COLORS[blockName];
  }

  // Try with minecraft: prefix
  const withPrefix = blockName.startsWith('minecraft:') ? blockName : `minecraft:${blockName}`;
  if (BLOCK_COLORS[withPrefix]) {
    return BLOCK_COLORS[withPrefix];
  }

  // Heuristic matching for common patterns
  if (blockName.includes('leaves')) return [0, 124, 0];
  if (blockName.includes('log') || blockName.includes('wood')) return [130, 102, 68];
  if (blockName.includes('planks')) return [199, 178, 124];
  if (blockName.includes('stone')) return [136, 136, 136];
  if (blockName.includes('dirt')) return [151, 109, 77];
  if (blockName.includes('sand')) return [247, 233, 163];
  if (blockName.includes('ore')) return [136, 136, 136];
  if (blockName.includes('concrete')) return [125, 125, 115];
  if (blockName.includes('wool')) return [234, 236, 236];
  if (blockName.includes('terracotta')) return [152, 94, 67];
  if (blockName.includes('coral')) return [214, 101, 143];
  if (blockName.includes('copper')) return [192, 107, 79];
  if (blockName.includes('nether')) return [112, 41, 41];
  if (blockName.includes('warped')) return [58, 142, 140];
  if (blockName.includes('crimson')) return [148, 63, 97];

  return DEFAULT_BLOCK_COLOR;
}

/**
 * Check if a block is transparent (should be skipped in top-down rendering)
 */
export function isTransparent(blockName: string): boolean {
  return TRANSPARENT_BLOCKS.has(blockName) || blockName === '' || blockName === 'air';
}
