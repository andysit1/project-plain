"""Singly linked list: detected as a linked-list structure.

Data layer: `while node: node = node.next` loops draw a traversal arrow along the chain.
"""
from typing import Optional


class Node:
    def __init__(self, value: int, next: "Optional[Node]" = None):
        self.value = value
        self.next = next


class LinkedList:
    def __init__(self):
        self.head: Optional[Node] = None
        self.size = 0

    def push_front(self, value: int):
        self.head = Node(value, self.head)
        self.size += 1

    def find(self, value: int) -> Optional[Node]:
        node = self.head
        while node:
            if node.value == value:
                return node
            node = node.next
        return None

    def reverse(self):
        prev = None
        node = self.head
        while node:
            nxt = node.next
            node.next = prev
            prev = node
            node = nxt
        self.head = prev

    def to_list(self) -> list[int]:
        out = []
        node = self.head
        while node:
            out.append(node.value)
            node = node.next
        return out
