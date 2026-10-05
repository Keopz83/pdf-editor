// Must match the .text-box / .text-field CSS so the saved output lines up with the screen.
export const BOX_INSET = 5;
export const TEXT_PAD_X = 4;
export const TEXT_PAD_Y = 2;
export const FONT_SIZE = 14;
export const LINE_HEIGHT = 1.2;

// Percentages keep boxes anchored when the canvas is scaled down.
export const pct = (value, total) => `${(value / total) * 100}%`;
export const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
