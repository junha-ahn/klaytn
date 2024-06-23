// Modifications Copyright 2024 The Kaia Authors
// Copyright 2022 The klaytn Authors
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

package params

import (
	"math/big"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestChainConfig_CheckConfigForkOrder(t *testing.T) {
	assert.Nil(t, TestnetChainConfig.CheckConfigForkOrder())
	assert.Nil(t, MainnetChainConfig.CheckConfigForkOrder())
}

func TestChainConfig_Copy(t *testing.T) {
	// Temporarily modify MainnetChainConfig to simulate copying `nil` field.
	savedBlock := MainnetChainConfig.LondonCompatibleBlock
	MainnetChainConfig.LondonCompatibleBlock = nil
	defer func() { MainnetChainConfig.LondonCompatibleBlock = savedBlock }()

	a := MainnetChainConfig
	b := a.Copy()

	// simple field
	assert.Equal(t, a.UnitPrice, b.UnitPrice)
	b.UnitPrice = 0x1111
	assert.NotEqual(t, a.UnitPrice, b.UnitPrice)

	// nested field
	assert.Equal(t, a.Istanbul.Epoch, b.Istanbul.Epoch)
	b.Istanbul.Epoch = 0x2222
	assert.NotEqual(t, a.Istanbul.Epoch, b.Istanbul.Epoch)

	// non-nil pointer field with omitempty
	assert.NotNil(t, a.IstanbulCompatibleBlock)
	assert.Equal(t, a.IstanbulCompatibleBlock, b.IstanbulCompatibleBlock)
	b.IstanbulCompatibleBlock = big.NewInt(111111)
	assert.NotEqual(t, a.IstanbulCompatibleBlock, b.IstanbulCompatibleBlock)

	// nil pointer field with omitempty
	assert.Nil(t, a.LondonCompatibleBlock)
	assert.Equal(t, a.LondonCompatibleBlock, b.LondonCompatibleBlock)
	b.LondonCompatibleBlock = big.NewInt(222222)
	assert.NotEqual(t, a.LondonCompatibleBlock, b.LondonCompatibleBlock)

	// non-nil pointer field without omitempty
	assert.Equal(t, a.Governance.Reward.MintingAmount, b.Governance.Reward.MintingAmount)
	b.Governance.Reward.MintingAmount = big.NewInt(3333333)
	assert.NotEqual(t, a.Governance.Reward.MintingAmount, b.Governance.Reward.MintingAmount)

	// nested field of *struct type
	assert.Equal(t, a.Governance.Reward.Ratio, b.Governance.Reward.Ratio)
	b.Governance.Reward = &RewardConfig{Ratio: "11/22/33"}
	assert.NotEqual(t, a.Governance.Reward.Ratio, b.Governance.Reward.Ratio)
}

func BenchmarkChainConfig_Copy(b *testing.B) {
	a := MainnetChainConfig
	for i := 0; i < b.N; i++ {
		a.Copy()
	}
}
