from icecream import ic

# look for 'from'!
class Py_Parser:
    def __init__(self) -> None:
        self.in_list = ['from']
        self.ex_list = ['import', 'as', 'from']  
        self.count_dict = {}

    "expecting ['from', 'os', 'import', 'path']"
    def read_line(self, line_list : list[str]):
        for line in line_list:
            if line not in self.ex_list:
                if line not in tuple(self.count_dict.keys()):
                    self.count_dict[line] = 1
                else:
                    self.count_dict[line] += 1 


#grabs the size of files base on ls and lines of code 
#might be useful to find a dep for it
class FileStatsGrabber:
    def __init__(self) -> None:
        pass




def read_line():
    pass

def parse(line : str):
    words = line.strip().split()
    if "from" in words:
        return words
    return None

def read_extension(in_filename : str):
    return in_filename.split(".")[-1]


parser = Py_Parser()

ext = read_extension("./input/demo.py")
ic("{}".format(ext))
with open("./input/demo.py") as f:
    lines = f.readlines()
    for line in lines:
        parser.read_line(line_list=parse(line))


ic(parser.count_dict)

