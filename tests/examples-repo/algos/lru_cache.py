"""LRU cache: a dict for lookup plus a doubly linked list for recency order.

Classes layer: Entry has prev/next (doubly-linked-list), LRUCache owns Entries.
Data layer: `index` is dict[str, Entry], `head`/`tail` point into the chain.
"""
from typing import Optional


class Entry:
    def __init__(self, key: str, value: int):
        self.key = key
        self.value = value
        self.prev: Optional["Entry"] = None
        self.next: Optional["Entry"] = None


class LRUCache:
    def __init__(self, capacity: int):
        self.capacity = capacity
        self.index: dict[str, Entry] = {}
        self.head: Optional[Entry] = None
        self.tail: Optional[Entry] = None

    def get(self, key: str) -> Optional[int]:
        entry = self.index.get(key)
        if entry is None:
            return None
        self._unlink(entry)
        self._push_front(entry)
        return entry.value

    def put(self, key: str, value: int):
        if key in self.index:
            self._unlink(self.index[key])
        entry = Entry(key, value)
        self.index[key] = entry
        self._push_front(entry)
        if len(self.index) > self.capacity:
            oldest = self.tail
            self._unlink(oldest)
            del self.index[oldest.key]

    def _push_front(self, entry: Entry):
        entry.next = self.head
        entry.prev = None
        if self.head:
            self.head.prev = entry
        self.head = entry
        if self.tail is None:
            self.tail = entry

    def _unlink(self, entry: Entry):
        if entry.prev:
            entry.prev.next = entry.next
        else:
            self.head = entry.next
        if entry.next:
            entry.next.prev = entry.prev
        else:
            self.tail = entry.prev
