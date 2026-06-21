/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { io, Socket } from 'socket.io-client';

// Initialize socket connection
// We use window.location.origin to connect to the same host/port as the page
export const socket: Socket = io(window.location.origin, {
  transports: ['websocket', 'polling'],
});
