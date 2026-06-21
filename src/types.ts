/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

export type Player = {
  id: string;
  x: number;
  y: number;
  angle: number;
  color: string;
  name: string;
  speed: number;
  laps: number;
  bestLapTime: number;
  nitro: number;
  drifting: boolean;
};
