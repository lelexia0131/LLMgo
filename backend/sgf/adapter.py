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
        self.ids: dict[sgf.Tree_node, str] = {}
        self.next_id = 0
        self.game = self._index()

    def _index(self) -> Game:
        nodes: list[GameNode] = []
        entries: dict[str, GameNode] = {}
        self.refs = {}
        pending = [(self.sgf.get_root(), None, 0)]
        while pending:
            node, parent, count = pending.pop()
            if node not in self.ids:
                self.ids[node] = str(self.next_id)
                self.next_id += 1
            node_id = self.ids[node]
            self.refs[node_id] = node
            color, pos = node.get_move()
            move = Move(color=color.upper(), coordinate=coordinate(*pos, self.sgf.get_size()) if pos else 'pass') if color else None
            count += int(move is not None)
            entry = GameNode(id=node_id, parent_id=parent, move=move, move_number=count,
                             comment=node.get('C') if node.has_property('C') else '')
            nodes.append(entry)
            entries[node_id] = entry
            if parent is not None:
                entries[parent].children.append(node_id)
            pending.extend((child, node_id, count) for child in reversed(list(node)))
        root = self.sgf.get_root()
        metadata = {key: str(root.get(key)) for key in ('SZ', 'PB', 'PW', 'BR', 'WR', 'KM', 'RU', 'RE', 'DT', 'HA', 'PL') if root.has_property(key)}
        black, white, _ = root.get_setup_stones()
        handicap = int(metadata.get('HA', '0'))
        metadata['game_form'] = (f'让 {handicap} 子' if handicap >= 2 else
                                 '让先' if handicap == 1 and not black and not white and metadata.get('PL', 'b').lower() == 'b' else '分先')
        if (black or white) and handicap < 2:
            metadata['game_form'] = '摆子局面'
        self.entries = entries
        return Game(id=uuid4().hex, current_node='0', nodes=nodes, metadata=metadata)

    def reindex(self, current: str) -> None:
        game_id = self.game.id
        self.game = self._index()
        self.game.id, self.game.current_node = game_id, current

    def context(self, revision: int, node_id: str | None = None) -> GameContext:
        size = self.sgf.get_size()
        board = boards.Board(size)
        numbers = [[0] * size for _ in range(size)]
        lineage: list[GameNode] = []
        entry = self.entries[node_id or self.game.current_node]
        while True:
            lineage.append(entry)
            if entry.parent_id is None:
                break
            entry = self.entries[entry.parent_id]
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
                for r, col in black | white | empty:
                    numbers[size - 1 - r][col] = 0
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
                    numbers = [[n if board.get(size - 1 - y, x) else 0 for x, n in enumerate(row)] for y, row in enumerate(numbers)]
                    numbers[size - 1 - pos[0]][pos[1]] = entry.move_number
                history.append(entry.move)
                player = 'W' if color == 'b' else 'B'
                last = entry.move.coordinate
        signs = [[{'b': 1, 'w': -1, None: 0}[board.get(size - 1 - y, x)] for x in range(size)] for y in range(size)]
        numbers = [[n if signs[y][x] else 0 for x, n in enumerate(row)] for y, row in enumerate(numbers)]
        current = self.entries[node_id or self.game.current_node]
        return GameContext(game_id=self.game.id, node_id=current.id, revision=revision,
                           move_number=current.move_number, to_play=player, move_history=history,
                           initial_stones=initial, initial_player=initial_player,
                           board_state=BoardState(size=size, sign_map=signs, last_move=last, move_numbers=numbers),
                           metadata=self.game.metadata, nodes=self.game.nodes, comment=current.comment)

    def serialize(self) -> bytes:
        return self.sgf.serialise()
