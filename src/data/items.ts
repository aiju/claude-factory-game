export const ITEM_IDS = ['ore', 'rock', 'coal', 'plate', 'part', 'frame'] as const;
export type ItemId = (typeof ITEM_IDS)[number];
export type RawItemId = 'ore' | 'rock' | 'coal';

export interface ItemDef {
  id: ItemId;
  name: string;
  raw: boolean;
}

export const ITEMS: Record<ItemId, ItemDef> = {
  ore: { id: 'ore', name: 'Ore', raw: true },
  rock: { id: 'rock', name: 'Rock', raw: true },
  coal: { id: 'coal', name: 'Coal', raw: true },
  plate: { id: 'plate', name: 'Plate', raw: false },
  part: { id: 'part', name: 'Part', raw: false },
  frame: { id: 'frame', name: 'Frame', raw: false },
};
