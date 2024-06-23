// Modifications Copyright 2024 The Kaia Authors
// Copyright 2018 The klaytn Authors
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

package utils

import (
	"fmt"
	"os"
	"path"
)

func WriteFile(content, filePath, fileName string) {
	err := os.MkdirAll(filePath, os.ModePerm)
	if err != nil {
		fmt.Printf("Failed to create folder %v failed: %v\n", filePath, err)
		os.Exit(-1)
	}

	err = os.WriteFile(path.Join(filePath, fileName), []byte(content), 0o644)
	if err != nil {
		fmt.Printf("Failed to write %v file: %v\n", fileName, err)
		os.Exit(-1)
	}
}
