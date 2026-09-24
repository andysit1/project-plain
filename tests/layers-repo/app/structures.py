"""Data structures for the classes (L1) and data (L3) layers."""
from dataclasses import dataclass, field
from typing import Optional

from app.config import load_config


class ListNode:
    def __init__(self, value: int, next: "Optional[ListNode]" = None):
        self.value = value
        self.next = next


class DNode:
    def __init__(self, value):
        self.value = value
        self.prev: Optional["DNode"] = None
        self.next: Optional["DNode"] = None


class TreeNode:
    def __init__(self, key: int):
        self.key = key
        self.left: Optional["TreeNode"] = None
        self.right: Optional["TreeNode"] = None


class GraphNode:
    def __init__(self, name: str):
        self.name = name
        self.neighbors: list["GraphNode"] = []


@dataclass
class Point:
    x: float
    y: float


@dataclass
class Polygon:
    name: str
    points: list[Point] = field(default_factory=list)


class Shape:
    def area(self) -> float:
        return 0.0


class Square(Shape):
    def __init__(self, side: float):
        self.side = side
        self.corner = Point(0.0, 0.0)

    def area(self) -> float:
        return self.side * self.side


class Registry:
    def __init__(self):
        self.items = []
        self.by_name = {}
        self.tags = set()
        self.root = TreeNode(0)

    def add(self, name, shape):
        self.items.append(shape)
        self.by_name[name] = shape
        self.tags.add(name)
        return shape.area()

    def build(self):
        sq = Square(2.0)
        self.add("sq", sq)
        cfg = load_config()
        return cfg


def linked_sum(head: ListNode) -> int:
    total = 0
    node = head
    while node:
        total += node.value
        node = node.next
    return total


def make_list(values):
    head = None
    for v in reversed(values):
        head = ListNode(v, head)
    return head


def grid(n):
    rows = []
    for i in range(n):
        row = []
        for j in range(n):
            row.append(i * j)
        rows.append(row)
    return rows


def count_words(lines: list[str]) -> dict[str, int]:
    counts = {}
    for line in lines:
        for word in line.split():
            counts[word] = counts.get(word, 0) + 1
    return counts
