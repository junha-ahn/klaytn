// Modifications Copyright 2024 The Kaia Authors
// Copyright 2023 The klaytn Authors
// This file is part of the klaytn library.
//
// The klaytn library is free software: you can redistribute it and/or modify
// it under the terms of the GNU Lesser General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// The klaytn library is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU Lesser General Public License for more details.
//
// You should have received a copy of the GNU Lesser General Public License
// along with the klaytn library. If not, see <http://www.gnu.org/licenses/>.
// Modified and improved for the Kaia development.

package blst

import blst "github.com/supranational/blst/bindings/go"

// Aliases to underlying blst go binding symbols
//
// Kaia uses the "minimal-pubkey-size" variant as defined in
// draft-irtf-cfrg-bls-signature-05#2.1.
// Public keys are points in G1 and signatures are points in G2.
type (
	blstScalar             = blst.Scalar
	blstMessage            = blst.Message
	blstSecretKey          = blst.SecretKey
	blstPublicKey          = blst.P1Affine
	blstSignature          = blst.P2Affine
	blstAggregatePublicKey = blst.P1Aggregate
	blstAggregateSignature = blst.P2Aggregate
)

const (
	blstScalarBytes = blst.BLST_SCALAR_BYTES
	blstRandBits    = 64
)
