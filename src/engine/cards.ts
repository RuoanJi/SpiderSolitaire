/** Suits: 0 = spades, 1 = hearts, 2 = diamonds, 3 = clubs. */
export type Suit = 0 | 1 | 2 | 3;
export type SuitCount = 1 | 2 | 4;

export interface Rules {
  /** Number of suits in the 104-card deck (1, 2 or 4). */
  suits: SuitCount;
  /** Windows 7 rule: you can't deal while any column is empty. */
  strictDeal: boolean;
}

export const DEFAULT_RULES: Rules = { suits: 1, strictDeal: true };

export interface CardDef {
  id: number;
  suit: Suit;
  /** 1 = Ace ... 13 = King */
  rank: number;
}

export const DECK_SIZE = 104;
export const COLUMNS = 10;

const SUIT_PATTERN: Record<SuitCount, Suit[]> = {
  1: [0],
  2: [0, 1],
  4: [0, 1, 2, 3],
};

/**
 * Card ids are 0..103. A card's suit and rank follow from its id and the suit
 * count, so a game only needs to store ids.
 * Ids 13k..13k+12 form one full suit set (Ace..King).
 */
export function suitOf(id: number, suits: SuitCount): Suit {
  const set = Math.floor(id / 13);
  const pattern = SUIT_PATTERN[suits];
  return pattern[set % pattern.length];
}

export function rankOf(id: number): number {
  return (id % 13) + 1;
}

export function cardDefs(suits: SuitCount): CardDef[] {
  const out: CardDef[] = [];
  for (let id = 0; id < DECK_SIZE; id++) out.push({ id, suit: suitOf(id, suits), rank: rankOf(id) });
  return out;
}

export const RANK_LABEL = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const SUIT_NAME = ['Spades', 'Hearts', 'Diamonds', 'Clubs'];
const RANK_NAME = ['', 'Ace', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'Jack', 'Queen', 'King'];

export function cardName(id: number, suits: SuitCount): string {
  return `${RANK_NAME[rankOf(id)]} of ${SUIT_NAME[suitOf(id, suits)]}`;
}
