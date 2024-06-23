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

//go:build rocksdb
// +build rocksdb

package database

import (
	"os"
)

func init() {
	testDatabases = append(testDatabases, newTestRocksDB)
	addRocksDB = true
}

func newTestRocksDB() (Database, func(), string) {
	dirName, err := os.MkdirTemp(os.TempDir(), "kaia-test-rocksdb-")
	if err != nil {
		panic("failed to create test file: " + err.Error())
	}
	config := GetDefaultRocksDBConfig()
	config.DisableMetrics = true
	db, err := NewRocksDB(dirName, config)
	if err != nil {
		panic("failed to create new rocksdb: " + err.Error())
	}

	return db, func() {
		db.Close()
		os.RemoveAll(dirName)
	}, "rdb"
}
