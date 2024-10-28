from typing import Union

from fastapi import FastAPI
from fastapi.templating import Jinja2Templates

app = FastAPI()


@app.get("/")
def read_root():
    return {"Hello": "World"}

@app.get("/map/")
def get_map():
    pass


@app.get("/items/{item_id}")
def read_item(item_id: int, q: Union[str, None] = None):
    return {"item_id": item_id, "q": q}