"""Shop domain model: inheritance, dataclass composition, lists of objects.

Classes layer: Product <- DigitalProduct / PhysicalProduct (inherits),
Order owns LineItems and a Customer, Customer owns an Address (composes).
"""
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class Address:
    street: str
    city: str
    postcode: str


@dataclass
class Customer:
    name: str
    email: str
    address: Address
    loyalty_points: int = 0


class Product:
    def __init__(self, sku: str, name: str, price: float):
        self.sku = sku
        self.name = name
        self.price = price
        self.tags = set()

    def tag(self, label):
        self.tags.add(label)

    def shipping_cost(self) -> float:
        return 0.0


class DigitalProduct(Product):
    def __init__(self, sku: str, name: str, price: float, download_url: str):
        super().__init__(sku, name, price)
        self.download_url = download_url


class PhysicalProduct(Product):
    def __init__(self, sku: str, name: str, price: float, weight_kg: float):
        super().__init__(sku, name, price)
        self.weight_kg = weight_kg

    def shipping_cost(self) -> float:
        return 4.99 + self.weight_kg * 1.5


@dataclass
class LineItem:
    product: Product
    quantity: int

    def subtotal(self) -> float:
        return self.product.price * self.quantity


@dataclass
class Order:
    order_id: int
    customer: Customer
    items: list[LineItem] = field(default_factory=list)
    coupon: Optional[str] = None

    def add(self, product: Product, quantity: int = 1):
        self.items.append(LineItem(product, quantity))

    def total(self) -> float:
        total = 0.0
        for item in self.items:
            total += item.subtotal() + item.product.shipping_cost()
        return total
