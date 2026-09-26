from uuid import uuid4
from sgfmill import sgf, boards
from backend.domain.board import BoardState
from backend.domain.context import GameContext
from backend.domain.game import Game, GameNode
from backend.domain.move import Move, coordinate


class SGFAdapter:
    """sgfmill owns parsing, property preservation, tree storage and captures."""

    def __init__(self, data: bytes | None = None) -> None:
        self.sgf = sgf.Sgf_game.from_bytes(data) if data else sgf.Sgf_game(size=19)
        if self.sgf.get_size() not in (9, 13, 19):
            raise ValueError('第一版支持 9、13、19 路棋盘')
        self.refs: dict[str, sgf.Tree_node] = {}
        self.game = self._index()

    def _index(self) -> Game:
        nodes: list[GameNode] = []
        pending = [(self.sgf.get_root(), None, 0)]
        while pending:
            node, parent, count = pending.pop()
            node_id = str(len(nodes))
            self.refs[node_id] = node
            color, pos = node.get_move()
            move = Move(color=color.upper(), coordinate=coordinate(*pos, self.sgf.get_size()) if pos else 'pass') if color else None
            count += int(move is not None)
            entry = GameNode(id=node_id, parent_id=parent, move=move, move_number=count,
                             comment=node.get('C') if node.has_property('C') else '')
            nodes.append(entry)
            if parent is not None:
                nodes[int(parent)].children.append(node_id)
            pending.extend((child, node_id, count) for child in reversed(list(node)))
        root = self.sgf.get_root()
        metadata = {key: str(root.get(key)) for key in ('SZ', 'PB', 'PW', 'BR', 'WR', 'KM', 'RU', 'RE', 'DT', 'HA') if root.has_property(key)}
        return Game(id=uuid4().hex, current_node='0', nodes=nodes, metadata=metadata)

    def context(self, revision: int) -> GameContext:
        size = self.sgf.get_size()
        board = boards.Board(size)
        numbers = [[0] * size for _ in range(size)]
        lineage: list[GameNode] = []
        entry = self.game.nodes[int(self.game.current_node)]
        while True:
            lineage.append(entry)
            if entry.parent_id is None:
                break
            entry = self.game.nodes[int(entry.parent_id)]
        history: list[Move] = []
        initial: list[Move] = []
        player = 'W' if int(self.game.metadata.get('HA', '0')) >= 2 else 'B'
        initial_player = player
        last = None
        for entry in reversed(lineage):
            node = self.refs[entry.id]
            if node.has_setup_stones():
                black, white, empty = node.get_setup_stones()
                if not board.apply_setup(black, white, empty):
                    raise ValueError('SGF 摆子形成无气棋块')
                # A midgame setup edits the position: history starts again here.
                history = []
                initial = [Move(color=c.upper(), coordinate=coordinate(r, col, size))
                           for c, (r, col) in board.list_occupied_points()]
                numbers = [[0] * size for _ in range(size)]
                initial_player = player
                last = None
            if node.has_property('PL'):
                player = node.get('PL').upper()
                if not history:
                    initial_player = player
            if entry.move:
                color, pos = node.get_move()
                if pos is not None:
                    if board.get(*pos) is not None:
                        raise ValueError('SGF 在已有棋子的位置落子')
                    board.play(*pos, color)
                    numbers[size - 1 - pos[0]][pos[1]] = entry.move_number
                history.append(entry.move)
                player = 'W' if color == 'b' else 'B'
                last = entry.move.coordinate
        signs = [[{'b': 1, 'w': -1, None: 0}[board.get(size - 1 - y, x)] for x in range(size)] for y in range(size)]
        numbers = [[n if signs[y][x] else 0 for x, n in enumerate(row)] for y, row in enumerate(numbers)]
        current = self.game.nodes[int(self.game.current_node)]
        return GameContext(game_id=self.game.id, node_id=current.id, revision=revision,
                           move_number=current.move_number, to_play=player, move_history=history,
                           initial_stones=initial, initial_player=initial_player,
                           board_state=BoardState(size=size, sign_map=signs, last_move=last, move_numbers=numbers),
                           metadata=self.game.metadata, nodes=self.game.nodes, comment=current.comment)

    def serialize(self) -> bytes:
        return self.sgf.serialise()
