/**
 * Copyright (c) TonTech.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import type { Address, Cell, MessageRelaxed } from '@ton/core';
import { SendMode } from '@ton/core';
export declare class ActionSendMsg {
    readonly mode: SendMode;
    readonly outMsg: MessageRelaxed;
    static readonly tag = 247711853;
    readonly tag = 247711853;
    constructor(mode: SendMode, outMsg: MessageRelaxed);
    serialize(): Cell;
}
export declare class ActionAddExtension {
    readonly address: Address;
    static readonly tag = 2;
    readonly tag = 2;
    constructor(address: Address);
    serialize(): Cell;
}
export declare class ActionRemoveExtension {
    readonly address: Address;
    static readonly tag = 3;
    readonly tag = 3;
    constructor(address: Address);
    serialize(): Cell;
}
export declare class ActionSetSignatureAuthAllowed {
    readonly allowed: boolean;
    static readonly tag = 4;
    readonly tag = 4;
    constructor(allowed: boolean);
    serialize(): Cell;
}
export type OutAction = ActionSendMsg;
export type ExtendedAction = ActionAddExtension | ActionRemoveExtension | ActionSetSignatureAuthAllowed;
export declare function isExtendedAction(action: OutAction | ExtendedAction): action is ExtendedAction;
export declare function packActionsList(actions: (OutAction | ExtendedAction)[]): Cell;
//# sourceMappingURL=actions.d.ts.map