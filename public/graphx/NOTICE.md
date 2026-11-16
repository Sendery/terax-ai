# GraphX in Terax

Source: https://github.com/Sendery/graphx
Pinned commit: 919e2408f62d04241b12df7920cf23746da6424b
Upstream package version: 1.7.0. The supplied bundle header still says 1.4.
engine.js is upstream dist/graphx.bundle.min.js with trailing whitespace removed.
The two affected lines are inside bundled ELK warning text; only trailing spaces change.
Bundled SHA-256: 2c309e3d8029a54862208fd21bd6c737b88d2f7dc7dd11d8231fa9a556d32351
Upstream SHA-256: 211f5848f3c4ae0867d7716b082679d4663fe626eee8dde1ca19b1170cfeddd7

Integration requested by the owner of Sendery/graphx. Upstream contains no LICENSE file
and its package declares no license; Terax does not assign an invented license to it.
Retain this provenance and obtain an explicit upstream license before independent
redistribution outside that authorization.

The bundle includes ELK / elkjs 0.12.0, Eclipse Public License 2.0.
ELK source: https://github.com/kieler/elkjs/tree/0.12.0
ELK license files here are copied unchanged from the published elkjs 0.12.0 package.
The original vendor copyright notices follow:

/*******************************************************************************
 * Copyright (c) 2017 Kiel University and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * https://www.eclipse.org/legal/epl-2.0.
 *
 * This Source Code may also be made available under the following Secondary
 * Licenses when the conditions for such availability set forth in the Eclipse
 * Public License v. 2.0 are satisfied: GPL-3.0 which is available at
 * https://www.gnu.org/licenses/gpl-3.0-standalone.html.
 *
 * SPDX-License-Identifier: EPL-2.0 OR GPL-3.0-or-later
 *******************************************************************************/

/*******************************************************************************
 * Copyright (c) 2021 Kiel University and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * https://www.eclipse.org/legal/epl-2.0.
 *
 * This Source Code may also be made available under the following Secondary
 * Licenses when the conditions for such availability set forth in the Eclipse
 * Public License v. 2.0 are satisfied: GPL-3.0 which is available at
 * https://www.gnu.org/licenses/gpl-3.0-standalone.html.
 *
 * SPDX-License-Identifier: EPL-2.0 OR GPL-3.0-or-later
 *******************************************************************************/
