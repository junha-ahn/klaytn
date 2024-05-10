package database

import (
	"bytes"
	"fmt"
	"runtime"
	"sync"
	"sync/atomic"
	"time"

	"github.com/klaytn/klaytn/log"
	"github.com/rcrowley/go-metrics"

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

	compTimeMeter       metrics.Meter // Meter for measuring the total time spent in database compaction
	compReadMeter       metrics.Meter // Meter for measuring the data read during compaction
	compWriteMeter      metrics.Meter // Meter for measuring the data written during compaction
	writeDelayNMeter    metrics.Meter // Meter for measuring the write delay number due to database compaction
	writeDelayMeter     metrics.Meter // Meter for measuring the write delay duration due to database compaction
	diskSizeGauge       metrics.Gauge // Gauge for tracking the size of all the levels in the database
	diskReadMeter       metrics.Meter // Meter for measuring the effective amount of data read
	diskWriteMeter      metrics.Meter // Meter for measuring the effective amount of data written
	memCompGauge        metrics.Gauge // Gauge for tracking the number of memory compaction
	level0CompGauge     metrics.Gauge // Gauge for tracking the number of table compaction in level0
	nonlevel0CompGauge  metrics.Gauge // Gauge for tracking the number of table compaction in non0 level
	seekCompGauge       metrics.Gauge // Gauge for tracking the number of table compaction caused by read opt
	manualMemAllocGauge metrics.Gauge // Gauge for tracking amount of non-managed memory currently allocated

	levelsGauge []metrics.Gauge // Gauge for tracking the number of tables in levels
	
	quitLock sync.RWMutex    // Mutex protecting the quit channel and the closed flag
	quitChan chan chan error // Quit channel to stop the metrics collection before closing the database
	closed   bool           

	log log.Logger

	activeComp    int           // Current number of active compactions
	compStartTime time.Time     // The start time of the earliest currently-active compaction
	compTime      atomic.Int64  // Total time spent in compaction in ns
	level0Comp    atomic.Uint32 // Total number of level-zero compactions
	nonLevel0Comp atomic.Uint32 // Total number of non level-zero compactions

	writeStalled        atomic.Bool  // Flag whether the write is stalled
	writeDelayStartTime time.Time    // The start time of the latest write stall
	writeDelayCount     atomic.Int64 // Total number of write stall counts
	writeDelayTime      atomic.Int64 // Total time spent in write stalls

	writeOptions *pebble.WriteOptions
}

func (d *pebbleDB) onCompactionBegin(info pebble.CompactionInfo) {
	if d.activeComp == 0 {
		d.compStartTime = time.Now()
	}
	l0 := info.Input[0]
	if l0.Level == 0 {
		d.level0Comp.Add(1)
	} else {
		d.nonLevel0Comp.Add(1)
	}
	d.activeComp++
}

func (d *pebbleDB) onCompactionEnd(info pebble.CompactionInfo) {
	if d.activeComp == 1 {
		d.compTime.Add(int64(time.Since(d.compStartTime)))
	} else if d.activeComp == 0 {
		panic("should not happen")
	}
	d.activeComp--
}

func (d *pebbleDB) onWriteStallBegin(b pebble.WriteStallBeginInfo) {
	d.writeDelayStartTime = time.Now()
	d.writeDelayCount.Add(1)
	d.writeStalled.Store(true)
}

func (d *pebbleDB) onWriteStallEnd() {
	d.writeDelayTime.Add(int64(time.Since(d.writeDelayStartTime)))
	d.writeStalled.Store(false)
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
		EventListener: &pebble.EventListener{
			CompactionBegin: db.onCompactionBegin,
			CompactionEnd:   db.onCompactionEnd,
			WriteStallBegin: db.onWriteStallBegin,
			WriteStallEnd:   db.onWriteStallEnd,
		},
		Logger: panicLogger{},
	}
	
	opt.Experimental.ReadSamplingMultiplier = -1
	
	innerDB, err := pebble.Open(file, opt)
	if err != nil {
		return nil, err
	}
	db.db = innerDB

	return db, nil
}
func (d *pebbleDB) Meter(prefix string) {
	d.compTimeMeter = metrics.GetOrRegisterMeter(prefix+"compact/time", nil)
	d.compReadMeter = metrics.GetOrRegisterMeter(prefix+"compact/input", nil)
	d.compWriteMeter = metrics.GetOrRegisterMeter(prefix+"compact/output", nil)
	d.diskSizeGauge = metrics.GetOrRegisterGauge(prefix+"disk/size", nil)
	d.diskReadMeter = metrics.GetOrRegisterMeter(prefix+"disk/read", nil)
	d.diskWriteMeter = metrics.GetOrRegisterMeter(prefix+"disk/write", nil)
	d.writeDelayMeter = metrics.GetOrRegisterMeter(prefix+"compact/writedelay/duration", nil)
	d.writeDelayNMeter = metrics.GetOrRegisterMeter(prefix+"compact/writedelay/counter", nil)
	d.memCompGauge = metrics.GetOrRegisterGauge(prefix+"compact/memory", nil)
	d.level0CompGauge = metrics.GetOrRegisterGauge(prefix+"compact/level0", nil)
	d.nonlevel0CompGauge = metrics.GetOrRegisterGauge(prefix+"compact/nonlevel0", nil)
	d.seekCompGauge = metrics.GetOrRegisterGauge(prefix+"compact/seek", nil)
	d.manualMemAllocGauge = metrics.GetOrRegisterGauge(prefix+"memory/manualalloc", nil)

	// Start up the metrics gathering and return
	go d.meter(metricsGatheringInterval, prefix)
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
		errc := make(chan error)
		d.quitChan <- errc
		if err := <-errc; err != nil {
			d.log.Error("Metrics collection failed", "err", err)
		}
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

func (d *pebbleDB) meter(refresh time.Duration, namespace string) {
	var errc chan error
	timer := time.NewTimer(refresh)
	defer timer.Stop()

	// Create storage and warning log tracer for write delay.
	var (
		compTimes  [2]int64
		compWrites [2]int64
		compReads  [2]int64

		nWrites [2]int64

		writeDelayTimes      [2]int64
		writeDelayCounts     [2]int64
		lastWriteStallReport time.Time
	)

	// Iterate ad infinitum and collect the stats
	for i := 1; errc == nil; i++ {
		var (
			compWrite int64
			compRead  int64
			nWrite    int64

			stats              = d.db.Metrics()
			compTime           = d.compTime.Load()
			writeDelayCount    = d.writeDelayCount.Load()
			writeDelayTime     = d.writeDelayTime.Load()
			nonLevel0CompCount = int64(d.nonLevel0Comp.Load())
			level0CompCount    = int64(d.level0Comp.Load())
		)
		writeDelayTimes[i%2] = writeDelayTime
		writeDelayCounts[i%2] = writeDelayCount
		compTimes[i%2] = compTime

		for _, levelMetrics := range stats.Levels {
			nWrite += int64(levelMetrics.BytesCompacted)
			nWrite += int64(levelMetrics.BytesFlushed)
			compWrite += int64(levelMetrics.BytesCompacted)
			compRead += int64(levelMetrics.BytesRead)
		}

		nWrite += int64(stats.WAL.BytesWritten)

		compWrites[i%2] = compWrite
		compReads[i%2] = compRead
		nWrites[i%2] = nWrite

		if d.writeDelayNMeter != nil {
			d.writeDelayNMeter.Mark(writeDelayCounts[i%2] - writeDelayCounts[(i-1)%2])
		}
		if d.writeDelayMeter != nil {
			d.writeDelayMeter.Mark(writeDelayTimes[i%2] - writeDelayTimes[(i-1)%2])
		}
		// Print a warning log if writing has been stalled for a while. The log will
		// be printed per minute to avoid overwhelming users.
		if d.writeStalled.Load() && writeDelayCounts[i%2] == writeDelayCounts[(i-1)%2] &&
			time.Now().After(lastWriteStallReport.Add(degradationWarnInterval)) {
			d.log.Warn("Database compacting, degraded performance")
			lastWriteStallReport = time.Now()
		}
		if d.compTimeMeter != nil {
			d.compTimeMeter.Mark(compTimes[i%2] - compTimes[(i-1)%2])
		}
		if d.compReadMeter != nil {
			d.compReadMeter.Mark(compReads[i%2] - compReads[(i-1)%2])
		}
		if d.compWriteMeter != nil {
			d.compWriteMeter.Mark(compWrites[i%2] - compWrites[(i-1)%2])
		}
		if d.diskSizeGauge != nil {
			d.diskSizeGauge.Update(int64(stats.DiskSpaceUsage()))
		}
		if d.diskReadMeter != nil {
			d.diskReadMeter.Mark(0) // pebble doesn't track non-compaction reads
		}
		if d.diskWriteMeter != nil {
			d.diskWriteMeter.Mark(nWrites[i%2] - nWrites[(i-1)%2])
		}

		// See https://github.com/cockroachdb/pebble/pull/1628#pullrequestreview-1026664054
		manuallyAllocated := stats.BlockCache.Size + int64(stats.MemTable.Size) + int64(stats.MemTable.ZombieSize)
		d.manualMemAllocGauge.Update(manuallyAllocated)
		d.memCompGauge.Update(stats.Flush.Count)
		d.nonlevel0CompGauge.Update(nonLevel0CompCount)
		d.level0CompGauge.Update(level0CompCount)
		d.seekCompGauge.Update(stats.Compact.ReadCount)

		for i, level := range stats.Levels {
			// Append metrics for additional layers
			if i >= len(d.levelsGauge) {
				d.levelsGauge = append(d.levelsGauge, metrics.GetOrRegisterGauge(namespace+fmt.Sprintf("tables/level%v", i), nil))
			}
			d.levelsGauge[i].Update(level.NumFiles)
		}

		// Sleep a bit, then repeat the stats collection
		select {
		case errc = <-d.quitChan:
			// Quit requesting, stop hammering the database
		case <-timer.C:
			timer.Reset(refresh)
			// Timeout, gather a new set of stats
		}
	}
	errc <- nil
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