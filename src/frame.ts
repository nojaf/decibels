/**
 * What the audio worklet posts to the page, about 20 times a second.
 *
 * Every level is a mean square (power) relative to digital full scale, not
 * decibels yet: the page converts, so calibration changes apply to numbers
 * already collected.
 */
export type Frame = {
  /** Seconds of audio this frame covers. */
  seconds: number;
  /** Mean square over this frame, A-weighted. Feeds Leq. */
  energyA: number;
  /** Mean square over this frame, unweighted. Feeds Leq. */
  energyZ: number;
  /** Fast (125 ms) exponential average at the end of the frame, A-weighted. */
  fastA: number;
  /** Slow (1 s) exponential average at the end of the frame, A-weighted. */
  slowA: number;
  fastZ: number;
  slowZ: number;
  /** Largest absolute sample in this frame, unweighted. 1 is full scale. */
  peak: number;
};
