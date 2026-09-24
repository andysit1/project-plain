"""Binary search tree: TreeNode has left/right children, so it is detected as a tree."""
from typing import Optional


class TreeNode:
    def __init__(self, key: int, value: str):
        self.key = key
        self.value = value
        self.left: Optional["TreeNode"] = None
        self.right: Optional["TreeNode"] = None


class BST:
    def __init__(self):
        self.root: Optional[TreeNode] = None
        self.count = 0

    def insert(self, key: int, value: str):
        if self.root is None:
            self.root = TreeNode(key, value)
            self.count = 1
            return
        node = self.root
        while True:
            if key < node.key:
                if node.left is None:
                    node.left = TreeNode(key, value)
                    break
                node = node.left
            else:
                if node.right is None:
                    node.right = TreeNode(key, value)
                    break
                node = node.right
        self.count += 1

    def in_order(self) -> list[int]:
        keys = []
        stack = []
        node = self.root
        while stack or node:
            while node:
                stack.append(node)
                node = node.left
            node = stack.pop()
            keys.append(node.key)
            node = node.right
        return keys
