// Modifications Copyright 2024 The Kaia Authors
// Modifications Copyright 2018 The klaytn Authors
// Copyright 2016 The go-ethereum Authors
// This file is part of go-ethereum.
//
// go-ethereum is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// go-ethereum is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with go-ethereum. If not, see <http://www.gnu.org/licenses/>.
//
// This file is derived from cmd/geth/accountcmd_test.go (2018/06/04).
// Modified and improved for the klaytn development.
// Modified and improved for the Kaia development.

package nodecmd

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/cespare/cp"
	"github.com/stretchr/testify/assert"
)

// These tests are 'smoke tests' for the account related
// subcommands and flags.
//
// For most tests, the test files from package accounts
// are copied into a temporary keystore directory.

func tmpDatadirWithKeystore(t *testing.T) string {
	datadir := tmpdir(t)
	keystore := filepath.Join(datadir, "keystore")
	source := filepath.Join("..", "..", "..", "accounts", "keystore", "testdata", "keystore")
	if err := cp.CopyAll(keystore, source); err != nil {
		t.Fatal(err)
	}
	return datadir
}

func TestAccountListEmpty(t *testing.T) {
	kaia := runKaia(t, "kaia-test", "account", "list")
	kaia.ExpectExit()
}

func TestAccountList(t *testing.T) {
	datadir := tmpDatadirWithKeystore(t)
	kaia := runKaia(t, "kaia-test", "account", "list", "--datadir", datadir)
	defer kaia.ExpectExit()
	if runtime.GOOS == "windows" {
		kaia.Expect(`
Account #0: {7ef5a6135f1fd6a02593eedc869c6d41d934aef8} keystore://{{.Datadir}}\keystore\UTC--2016-03-22T12-57-55.920751759Z--7ef5a6135f1fd6a02593eedc869c6d41d934aef8
Account #1: {f466859ead1932d743d622cb74fc058882e8648a} keystore://{{.Datadir}}\keystore\aaa
Account #2: {289d485d9771714cce91d3393d764e1311907acc} keystore://{{.Datadir}}\keystore\zzz
`)
	} else {
		kaia.Expect(`
Account #0: {7ef5a6135f1fd6a02593eedc869c6d41d934aef8} keystore://{{.Datadir}}/keystore/UTC--2016-03-22T12-57-55.920751759Z--7ef5a6135f1fd6a02593eedc869c6d41d934aef8
Account #1: {f466859ead1932d743d622cb74fc058882e8648a} keystore://{{.Datadir}}/keystore/aaa
Account #2: {289d485d9771714cce91d3393d764e1311907acc} keystore://{{.Datadir}}/keystore/zzz
`)
	}
}

func TestAccountNew(t *testing.T) {
	kaia := runKaia(t, "kaia-test", "account", "new", "--lightkdf")
	defer kaia.ExpectExit()
	kaia.Expect(`
Your new account is locked with a password. Please give a password. Do not forget this password.
!! Unsupported terminal, password will be echoed.
Passphrase: {{.InputLine "foobar"}}
Repeat passphrase: {{.InputLine "foobar"}}
`)
	kaia.ExpectRegexp(`Address: \{[0-9a-f]{40}\}\n`)
}

func TestAccountNewBadRepeat(t *testing.T) {
	kaia := runKaia(t, "kaia-test", "account", "new", "--lightkdf")
	defer kaia.ExpectExit()
	kaia.Expect(`
Your new account is locked with a password. Please give a password. Do not forget this password.
!! Unsupported terminal, password will be echoed.
Passphrase: {{.InputLine "something"}}
Repeat passphrase: {{.InputLine "something else"}}
Fatal: Passphrases do not match
`)
}

func TestAccountUpdate(t *testing.T) {
	datadir := tmpDatadirWithKeystore(t)
	kaia := runKaia(t, "kaia-test", "account", "update",
		"--datadir", datadir, "--lightkdf",
		"f466859ead1932d743d622cb74fc058882e8648a")
	defer kaia.ExpectExit()
	kaia.Expect(`
Unlocking account f466859ead1932d743d622cb74fc058882e8648a | Attempt 1/3
!! Unsupported terminal, password will be echoed.
Passphrase: {{.InputLine "foobar"}}
Please give a new password. Do not forget this password.
Passphrase: {{.InputLine "foobar2"}}
Repeat passphrase: {{.InputLine "foobar2"}}
`)
}

func TestUnlockFlag(t *testing.T) {
	datadir := tmpDatadirWithKeystore(t)
	kaia := runKaia(t, "kaia-test",
		"--datadir", datadir, "--nat", "none", "--nodiscover", "--maxconnections", "0", "--port", "0",
		"--unlock", "f466859ead1932d743d622cb74fc058882e8648a",
		"js", "testdata/empty.js")
	kaia.Expect(`
Unlocking account f466859ead1932d743d622cb74fc058882e8648a | Attempt 1/3
!! Unsupported terminal, password will be echoed.
Passphrase: {{.InputLine "foobar"}}
`)
	kaia.ExpectExit()

	wantMessages := []string{
		"Unlocked account",
		"0xf466859eAD1932D743d622CB74FC058882E8648A",
	}
	for _, m := range wantMessages {
		if !strings.Contains(kaia.StderrText(), m) {
			t.Errorf("stderr text does not contain %q", m)
		}
	}
}

func TestUnlockFlagWrongPassword(t *testing.T) {
	datadir := tmpDatadirWithKeystore(t)
	kaia := runKaia(t, "kaia-test",
		"--datadir", datadir, "--nat", "none", "--nodiscover", "--maxconnections", "0", "--port", "0",
		"--unlock", "f466859ead1932d743d622cb74fc058882e8648a")
	defer kaia.ExpectExit()
	kaia.Expect(`
Unlocking account f466859ead1932d743d622cb74fc058882e8648a | Attempt 1/3
!! Unsupported terminal, password will be echoed.
Passphrase: {{.InputLine "wrong1"}}
Unlocking account f466859ead1932d743d622cb74fc058882e8648a | Attempt 2/3
Passphrase: {{.InputLine "wrong2"}}
Unlocking account f466859ead1932d743d622cb74fc058882e8648a | Attempt 3/3
Passphrase: {{.InputLine "wrong3"}}
Fatal: Failed to unlock account f466859ead1932d743d622cb74fc058882e8648a (could not decrypt key with given passphrase)
`)
}

// https://github.com/ethereum/go-ethereum/issues/1785
func TestUnlockFlagMultiIndex(t *testing.T) {
	datadir := tmpDatadirWithKeystore(t)
	kaia := runKaia(t, "kaia-test",
		"--datadir", datadir, "--nat", "none", "--nodiscover", "--maxconnections", "0", "--port", "0",
		"--unlock", "0,2",
		"js", "testdata/empty.js")
	kaia.Expect(`
Unlocking account 0 | Attempt 1/3
!! Unsupported terminal, password will be echoed.
Passphrase: {{.InputLine "foobar"}}
Unlocking account 2 | Attempt 1/3
Passphrase: {{.InputLine "foobar"}}
`)
	kaia.ExpectExit()

	wantMessages := []string{
		"Unlocked account",
		"0x7EF5A6135f1FD6a02593eEdC869c6D41D934aef8",
		"0x289d485D9771714CCe91D3393D764E1311907ACc",
	}
	for _, m := range wantMessages {
		if !strings.Contains(kaia.StderrText(), m) {
			t.Errorf("stderr text does not contain %q", m)
		}
	}
}

func TestUnlockFlagPasswordFile(t *testing.T) {
	datadir := tmpDatadirWithKeystore(t)
	kaia := runKaia(t, "kaia-test",
		"--datadir", datadir, "--nat", "none", "--nodiscover", "--maxconnections", "0", "--port", "0",
		"--password", "testdata/passwords.txt", "--unlock", "0,2",
		"js", "testdata/empty.js")
	kaia.ExpectExit()

	wantMessages := []string{
		"Unlocked account",
		"0x7EF5A6135f1FD6a02593eEdC869c6D41D934aef8",
		"0x289d485D9771714CCe91D3393D764E1311907ACc",
	}
	for _, m := range wantMessages {
		if !strings.Contains(kaia.StderrText(), m) {
			t.Errorf("stderr text does not contain %q", m)
		}
	}
}

func TestUnlockFlagPasswordFileWrongPassword(t *testing.T) {
	datadir := tmpDatadirWithKeystore(t)
	kaia := runKaia(t, "kaia-test",
		"--datadir", datadir, "--nat", "none", "--nodiscover", "--maxconnections", "0", "--port", "0",
		"--password", "testdata/wrong-passwords.txt", "--unlock", "0,2")
	defer kaia.ExpectExit()
	kaia.Expect(`
Fatal: Failed to unlock account 0 (could not decrypt key with given passphrase)
`)
}

func TestUnlockFlagAmbiguous(t *testing.T) {
	store := filepath.Join("..", "..", "..", "accounts", "keystore", "testdata", "dupes")
	kaia := runKaia(t, "kaia-test",
		"--keystore", store, "--nat", "none", "--nodiscover", "--maxconnections", "0", "--port", "0",
		"--unlock", "f466859ead1932d743d622cb74fc058882e8648a",
		"js", "testdata/empty.js")
	defer kaia.ExpectExit()

	// Helper for the expect template, returns absolute keystore path.
	kaia.SetTemplateFunc("keypath", func(file string) string {
		abs, _ := filepath.Abs(filepath.Join(store, file))
		return abs
	})
	kaia.Expect(`
Unlocking account f466859ead1932d743d622cb74fc058882e8648a | Attempt 1/3
!! Unsupported terminal, password will be echoed.
Passphrase: {{.InputLine "foobar"}}
Multiple key files exist for address f466859ead1932d743d622cb74fc058882e8648a:
   keystore://{{keypath "1"}}
   keystore://{{keypath "2"}}
Testing your passphrase against all of them...
Your passphrase unlocked keystore://{{keypath "1"}}
In order to avoid this warning, you need to remove the following duplicate key files:
   keystore://{{keypath "2"}}
`)
	kaia.ExpectExit()

	wantMessages := []string{
		"Unlocked account",
		"0xf466859eAD1932D743d622CB74FC058882E8648A",
	}
	for _, m := range wantMessages {
		if !strings.Contains(kaia.StderrText(), m) {
			t.Errorf("stderr text does not contain %q", m)
		}
	}
}

func TestUnlockFlagAmbiguousWrongPassword(t *testing.T) {
	store := filepath.Join("..", "..", "..", "accounts", "keystore", "testdata", "dupes")
	kaia := runKaia(t, "kaia-test",
		"--keystore", store, "--nat", "none", "--nodiscover", "--maxconnections", "0", "--port", "0",
		"--unlock", "f466859ead1932d743d622cb74fc058882e8648a")
	defer kaia.ExpectExit()

	// Helper for the expect template, returns absolute keystore path.
	kaia.SetTemplateFunc("keypath", func(file string) string {
		abs, _ := filepath.Abs(filepath.Join(store, file))
		return abs
	})
	kaia.Expect(`
Unlocking account f466859ead1932d743d622cb74fc058882e8648a | Attempt 1/3
!! Unsupported terminal, password will be echoed.
Passphrase: {{.InputLine "wrong"}}
Multiple key files exist for address f466859ead1932d743d622cb74fc058882e8648a:
   keystore://{{keypath "1"}}
   keystore://{{keypath "2"}}
Testing your passphrase against all of them...
Fatal: None of the listed files could be unlocked.
`)
	kaia.ExpectExit()
}

func TestBlsInfo(t *testing.T) {
	// Test datadir/nodekey -> bls-publicinfo.json
	var (
		datadir     = tmpdir(t)
		nodekeyPath = filepath.Join(datadir, "klay", "nodekey")
		nodekeyHex  = "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"

		outputPath  = "bls-publicinfo-0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266.json"
		expectPrint = `Successfully wrote 'bls-publicinfo-0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266.json'`
		expectFile  = `{
			"address": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
			"blsPublicKeyInfo": {
				"publicKey": "876006073c4ef19d23df948fea3e7e95398d6a7b5acc6a510f24e2d5160bbbd9f636a58cdfe69c8eba42b1cfce0fa60a",
				"pop": "ac7886654439a16c53be123d1956bb1bfe4a04b118ac50d9d4a56aef8a8e1e23128a8d720a9290a4dfa411df2384f5dc0bf9ee9861846fe1bd3f0fbd998935deda91cb28ceefe5ff8f307b43c0559dfbc96d7f2b6361980edb0298f28479908e"
			}
		}`
	)
	defer os.RemoveAll(datadir)
	defer os.Remove(outputPath)
	t.Logf("datadir: %s", datadir)

	// Save nodekey before node starts
	assert.Nil(t, os.MkdirAll(filepath.Join(datadir, "klay"), 0o700))
	assert.Nil(t, os.WriteFile(nodekeyPath, []byte(nodekeyHex), 0o400))
	server := runKaia(t, "kaia-test", "--datadir", datadir,
		"--netrestrict", "127.0.0.1/32", "--port", "0", "--verbosity", "2")
	time.Sleep(5 * time.Second) // Simple way to wait for the RPC endpoint to open

	os.Remove(outputPath) // delete before test, because otherwise the "already exists" error occurs
	client := runKaia(t, "kaia-test", "account", "bls-info", "--datadir", datadir)
	client.ExpectRegexp(expectPrint)

	content, err := os.ReadFile(outputPath)
	assert.Nil(t, err)
	assert.JSONEq(t, expectFile, string(content))

	server.Interrupt()
	server.ExpectExit()
}

func TestBlsImport(t *testing.T) {
	// Test keystore + password -> datadir/bls-nodekey
	var (
		// Scrypt Test Vector from https://eips.ethereum.org/EIPS/eip-2335
		keystorePath = "../../../accounts/keystore/testdata/eip2335_scrypt.json"
		passwordPath = "../../../accounts/keystore/testdata/eip2335_password.txt"

		datadir     = tmpdir(t)
		outputPath  = filepath.Join(datadir, "klay", "bls-nodekey")
		expectPrint = fmt.Sprintf(
			"Importing BLS key: pub=9612d7a727c9d0a22e185a1c768478dfe919cada9266988cb32359c11f2b7b27f4ae4040902382ae2910c15e2b420d07\n"+
				"Successfully wrote '%s/klay/bls-nodekey'", datadir)
		expectFile = "000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f"
	)
	defer os.RemoveAll(datadir)
	t.Logf("datadir: %s", datadir)

	kaia := runKaia(t, "kaia-test", "account", "bls-import", "--datadir", datadir,
		"--bls-nodekeystore", keystorePath, "--password", passwordPath)
	kaia.ExpectRegexp(expectPrint)

	content, err := os.ReadFile(outputPath)
	assert.Nil(t, err)
	assert.Regexp(t, expectFile, string(content))
}

func TestBlsExport(t *testing.T) {
	// Test datadir/bls-nodekey -> bls-keystore.json
	var (
		datadir        = tmpdir(t)
		nodekeyPath    = filepath.Join(datadir, "klay", "nodekey")
		nodekeyHex     = "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
		blsnodekeyPath = filepath.Join(datadir, "klay", "bls-nodekey")
		blsnodekeyHex  = "000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f"

		outputPath  = "bls-keystore-0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266.json"
		expectPrint = `Successfully wrote 'bls-keystore-0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266.json'`
		expectFile  = []string{
			`"pubkey":"9612d7a727c9d0a22e185a1c768478dfe919cada9266988cb32359c11f2b7b27f4ae4040902382ae2910c15e2b420d07"`,
			`"path":""`,
			`"version":4`,
		}
	)
	defer os.RemoveAll(datadir)
	defer os.Remove(outputPath)
	t.Logf("datadir: %s", datadir)

	assert.Nil(t, os.MkdirAll(filepath.Join(datadir, "klay"), 0o700))
	assert.Nil(t, os.WriteFile(nodekeyPath, []byte(nodekeyHex), 0o400))
	assert.Nil(t, os.WriteFile(blsnodekeyPath, []byte(blsnodekeyHex), 0o400))

	os.Remove(outputPath) // delete before test, because otherwise the "already exists" error occurs
	kaia := runKaia(t, "kaia-test", "account", "bls-export", "--datadir", datadir)
	kaia.InputLine("1234") // Enter password
	kaia.InputLine("1234") // Confirm password
	kaia.ExpectRegexp(expectPrint)

	content, err := os.ReadFile(outputPath)
	assert.Nil(t, err)
	for _, expectField := range expectFile {
		assert.Regexp(t, expectField, string(content))
	}
}
