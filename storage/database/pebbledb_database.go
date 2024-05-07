package database

import (
	"bytes"
	"fmt"
	"runtime"
	"sync"
	"time"

	"github.com/klaytn/klaytn/log"

	"github.com/cockroachdb/pebble"
	"github.com/cockroachdb/pebble/bloom"
)

const (
	minCache = 16
	minHandles = 16
	metricsGatheringInterval = 3 * time.Second
	degradationWarnInterval = time.Minute
)

type pebbleDB struct {
	fn string     
	db *pebble.DB 

	quitLock sync.RWMutex   
	quitChan chan chan error
	closed   bool           

	log log.Logger

	writeOptions *pebble.WriteOptions
}


type panicLogger struct{}

func (l panicLogger) Infof(format string, args ...interface{}) {
	logger.Info(fmt.Sprintf(format, args...))
}
func (l panicLogger) Errorf(format string, args ...interface{}) {
	logger.Error(fmt.Sprintf(format, args...))
}
func (l panicLogger) Fatalf(format string, args ...interface{}) {
	logger.Crit(fmt.Sprintf(format, args...))
}

func NewPebbleDB(file string) (*pebbleDB, error) {
	// #TODO: it has to be argument
	cache := minCache
	handles := minHandles
	ephemeral := false
	readonly := false
	
	maxMemTableSize := (1<<31)<<(^uint(0)>>63) - 1
	memTableLimit := 2
	memTableSize := cache * 1024 * 1024 / 2 / memTableLimit
	if memTableSize >= maxMemTableSize {
		memTableSize = maxMemTableSize - 1
	}
	db := &pebbleDB{
		fn:           file,
		log:          logger,
		quitChan:     make(chan chan error),
		writeOptions: &pebble.WriteOptions{Sync: ephemeral},
	}
	opt := &pebble.Options{
		Cache:        pebble.NewCache(int64(cache * 1024 * 1024)),
		MaxOpenFiles: handles,
		MemTableSize: uint64(memTableSize),
		MemTableStopWritesThreshold: memTableLimit,
		MaxConcurrentCompactions: func() int { return runtime.NumCPU() },
		Levels: []pebble.LevelOptions{
			{TargetFileSize: 2 * 1024 * 1024, FilterPolicy: bloom.FilterPolicy(10)},
			{TargetFileSize: 2 * 1024 * 1024, FilterPolicy: bloom.FilterPolicy(10)},
			{TargetFileSize: 2 * 1024 * 1024, FilterPolicy: bloom.FilterPolicy(10)},
			{TargetFileSize: 2 * 1024 * 1024, FilterPolicy: bloom.FilterPolicy(10)},
			{TargetFileSize: 2 * 1024 * 1024, FilterPolicy: bloom.FilterPolicy(10)},
			{TargetFileSize: 2 * 1024 * 1024, FilterPolicy: bloom.FilterPolicy(10)},
			{TargetFileSize: 2 * 1024 * 1024, FilterPolicy: bloom.FilterPolicy(10)},
		},
		ReadOnly: readonly,
	
		Logger: panicLogger{},
	}
	
	opt.Experimental.ReadSamplingMultiplier = -1

	// #TODO: implement metrics
	
	innerDB, err := pebble.Open(file, opt)
	if err != nil {
		return nil, err
	}
	db.db = innerDB

	return db, nil
}
func (d *pebbleDB) Meter(prefix string) {
	// #TODO: implement metrics
}

func (db *pebbleDB) TryCatchUpWithPrimary() error {
	return nil
}
func (db *pebbleDB) Type() DBType {
	return PebbleDB
}


func (d *pebbleDB) Close() {
	d.quitLock.Lock()
	defer d.quitLock.Unlock()

	if d.closed {
		return 
	}
	d.closed = true
	if d.quitChan != nil {
		// TODO: currenctly Skip, because we dont implement metrics
		// errc := make(chan error)
		// d.quitChan <- errc
		// if err := <-errc; err != nil {
		// 	d.log.Error("Metrics collection failed", "err", err)
		// }
		d.quitChan = nil
	}
	d.db.Close()
}

func (d *pebbleDB) Has(key []byte) (bool, error) {
	d.quitLock.RLock()
	defer d.quitLock.RUnlock()
	if d.closed {
		return false, pebble.ErrClosed
	}
	_, closer, err := d.db.Get(key)
	if err == pebble.ErrNotFound {
		return false, nil
	} else if err != nil {
		return false, err
	}
	closer.Close()
	return true, nil
}

func (d *pebbleDB) Get(key []byte) ([]byte, error) {
	d.quitLock.RLock()
	defer d.quitLock.RUnlock()
	if d.closed {
		return nil, pebble.ErrClosed
	}
	dat, closer, err := d.db.Get(key)
	if err != nil {
		if err == pebble.ErrNotFound {
			return nil, dataNotFoundErr
		}
		return nil, err
	}
	ret := make([]byte, len(dat))
	copy(ret, dat)
	closer.Close()
	return ret, nil
}

func (d *pebbleDB) Put(key []byte, value []byte) error {
	d.quitLock.RLock()
	defer d.quitLock.RUnlock()
	if d.closed {
		return pebble.ErrClosed
	}
	return d.db.Set(key, value, d.writeOptions)
}

func (d *pebbleDB) Delete(key []byte) error {
	d.quitLock.RLock()
	defer d.quitLock.RUnlock()
	if d.closed {
		return pebble.ErrClosed
	}
	return d.db.Delete(key, nil)
}

func (d *pebbleDB) NewBatch() Batch {
	return &batch{
		b:  d.db.NewBatch(),
		db: d,
	}
}


func upperBound(prefix []byte) (limit []byte) {
	for i := len(prefix) - 1; i >= 0; i-- {
		c := prefix[i]
		if c == 0xff {
			continue
		}
		limit = make([]byte, i+1)
		copy(limit, prefix)
		limit[i] = c + 1
		break
	}
	return limit
}

func (d *pebbleDB) Stat(property string) (string, error) {
	return d.db.Metrics().String(), nil
}

func (d *pebbleDB) Compact(start []byte, limit []byte) error {
	if limit == nil {
		limit = bytes.Repeat([]byte{0xff}, 32)
	}
	return d.db.Compact(start, limit, true)
}

func (d *pebbleDB) Path() string {
	return d.fn
}


type batch struct {
	b    *pebble.Batch
	db   *pebbleDB
	size int
}

func (b *batch) Put(key, value []byte) error {
	b.b.Set(key, value, nil)
	b.size += len(key) + len(value)
	return nil
}

func (b *batch) Delete(key []byte) error {
	b.b.Delete(key, nil)
	b.size += len(key)
	return nil
}

func (b *batch) ValueSize() int {
	return b.size
}

func (b *batch) Write() error {
	b.db.quitLock.RLock()
	defer b.db.quitLock.RUnlock()
	if b.db.closed {
		return pebble.ErrClosed
	}
	return b.b.Commit(b.db.writeOptions)
}

func (b *batch) Reset() {
	b.b.Reset()
	b.size = 0
}
func (b *batch) Release() {
	// do nothing
}

func (b *batch) Replay(w KeyValueWriter) error {
	reader := b.b.Reader()
	for {
		kind, k, v, ok, err := reader.Next()
		if !ok || err != nil {
			break
		}
	
	
		if kind == pebble.InternalKeyKindSet {
			w.Put(k, v)
		} else if kind == pebble.InternalKeyKindDelete {
			w.Delete(k)
		} else {
			return fmt.Errorf("unhandled operation, keytype: %v", kind)
		}
	}
	return nil
}


type pebbleIterator struct {
	iter     *pebble.Iterator
	moved    bool
	released bool
}

func (d *pebbleDB) NewIterator(prefix []byte, start []byte) Iterator {
	iter, _ := d.db.NewIter(&pebble.IterOptions{
		LowerBound: append(prefix, start...),
		UpperBound: upperBound(prefix),
	})
	iter.First()
	return &pebbleIterator{iter: iter, moved: true, released: false}
}

func (iter *pebbleIterator) Next() bool {
	if iter.moved {
		iter.moved = false
		return iter.iter.Valid()
	}
	return iter.iter.Next()
}

func (iter *pebbleIterator) Error() error {
	return iter.iter.Error()
}

func (iter *pebbleIterator) Key() []byte {
	return iter.iter.Key()
}

func (iter *pebbleIterator) Value() []byte {
	return iter.iter.Value()
}

func (iter *pebbleIterator) Release() {
	if !iter.released {
		iter.iter.Close()
		iter.released = true
	}
}