from backend.domain.context import GameContext
from backend.domain.move import BoardMarker, point
from backend.sgf.adapter import SGFAdapter
from sgfmill import boards, sgf
from dataclasses import dataclass


@dataclass
class EditSnapshot:
    data: bytes
    node_ids: list[str]
    current: str



class GameService:
    def __init__(self) -> None:
        self.adapter = SGFAdapter()
        self.revision = 0
        self.markers: list[BoardMarker] = []
        self.filename: str | None = None
        self.undo_stack: list[EditSnapshot] = []
        self.redo_stack: list[EditSnapshot] = []
        self.move_losses: dict[str, float] = {}

    def context(self) -> GameContext:
        context = self.adapter.context(self.revision)
        context.markers = list(self.markers)
        context.filename = self.filename
        context.can_undo = bool(self.undo_stack)
        context.can_redo = bool(self.redo_stack)
        context.move_losses = dict(self.move_losses)
        return context

    def check(self, revision: int) -> None:
        if revision != self.revision:
            raise ValueError('局面或标记已改变，请重新操作')

    def open(self, data: bytes, filename: str | None) -> GameContext:
        adapter = SGFAdapter(data)
        adapter.context(0)  # Validate before replacing the current record.
        self.adapter, self.filename = adapter, filename
        self.undo_stack.clear()
        self.redo_stack.clear()
        self.move_losses.clear()
        self.reset_markers()
        return self.context()

    def reset_markers(self) -> None:
        self.markers = []
        self.revision += 1

    def navigate(self, direction: str, node_id: str | None = None) -> GameContext:
        game = self.adapter.game
        current = self.adapter.entries[game.current_node]
        target = game.current_node
        if direction == 'first':
            target = '0'
        elif direction == 'previous':
            target = current.parent_id or '0'
        elif direction == 'next' and current.children:
            target = current.children[0]
        elif direction == 'last':
            while current.children:
                current = self.adapter.entries[current.children[0]]
            target = current.id
        elif direction == 'node':
            if node_id not in self.adapter.refs:
                raise ValueError('棋谱节点不存在')
            target = node_id
        old = game.current_node
        game.current_node = target
        try:
            self.adapter.context(self.revision)
        except ValueError:
            game.current_node = old
            raise
        self.reset_markers()
        return self.context()

    def set_candidates(self, coordinates: list[str], revision: int) -> GameContext:
        self.check(revision)
        self.reset_markers()
        self.markers = [BoardMarker(id=i + 1, coordinate=c, role='best_move' if i == 0 else 'candidate')
                        for i, c in enumerate(coordinates[:3])]
        return self.context()

    def snapshot(self) -> EditSnapshot:
        return EditSnapshot(self.adapter.serialize(), list(self.adapter.refs), self.adapter.game.current_node)

    def remember(self) -> None:
        self.undo_stack.append(self.snapshot())
        self.redo_stack.clear()

    def restore(self, snapshot: EditSnapshot) -> None:
        old = self.adapter
        adapter = SGFAdapter(snapshot.data)
        adapter.ids = dict(zip(adapter.refs.values(), snapshot.node_ids))
        adapter.next_id = old.next_id
        adapter.game.id = old.game.id
        adapter.reindex(snapshot.current)
        self.adapter = adapter
        self.move_losses.clear()

    def edit(self, action: str, revision: int) -> GameContext:
        self.check(revision)
        if action in ('undo', 'redo'):
            source, target = (self.undo_stack, self.redo_stack) if action == 'undo' else (self.redo_stack, self.undo_stack)
            if source:
                target.append(self.snapshot())
                self.restore(source.pop())
        else:
            current = self.adapter.refs[self.adapter.game.current_node]
            if current.parent is None:
                raise ValueError('不能删除根节点')
            # A branch begins immediately below the nearest fork (or root).
            if action == 'deleteBranch':
                while current.parent.parent is not None and len(current.parent) == 1:
                    current = current.parent
            self.remember()
            parent = current.parent
            current.delete()  # Descendants belong to the deleted position.
            self.adapter.reindex(self.adapter.ids[parent])
            self.move_losses.clear()
        self.reset_markers()
        return self.context()

    def comment(self, text: str, revision: int) -> GameContext:
        self.check(revision)
        current = self.adapter.refs[self.adapter.game.current_node]
        if text != self.context().comment:
            upgraded = None
            try:
                text.encode(current.get_encoding())
            except UnicodeEncodeError:
                snapshot = self.snapshot()
                snapshot.data = sgf.Sgf_game.from_string(snapshot.data.decode(self.adapter.sgf.get_charset())).serialise()
                upgraded = snapshot
            self.remember()
            if upgraded:
                self.restore(upgraded)
                current = self.adapter.refs[self.adapter.game.current_node]
            current.set('C', text)
            self.adapter.reindex(self.adapter.game.current_node)
            self.revision += 1
        return self.context()

    def play(self, coordinate: str, revision: int) -> tuple[GameContext, bool]:
        self.check(revision)
        context = self.context()
        pos = point(coordinate, context.board_state.size)
        coordinate = coordinate.upper() if pos else 'pass'
        parent = self.adapter.refs[context.node_id]
        size = context.board_state.size
        if pos is not None:
            board = boards.Board(size)
            black, white = set(), set()
            for y, row in enumerate(context.board_state.sign_map):
                for x, sign in enumerate(row):
                    if sign:
                        (black if sign == 1 else white).add((size - 1 - y, x))
            board.apply_setup(black, white, set())
            if board.get(*pos):
                raise ValueError('不能在已有棋子的位置落子')
            board.play(*pos, context.to_play.lower())
            if board.get(*pos) is None:
                raise ValueError('不能自杀落子')
            signs = [[{'b': 1, 'w': -1, None: 0}[board.get(size - 1 - y, x)] for x in range(size)] for y in range(size)]
            # Japanese/Korean use simple ko; other supported rules reject positional repetition.
            simple = context.metadata.get('RU', '').lower() in ('japanese', 'jp', 'korean')
            ancestor = parent
            moves = 0
            while ancestor is not None:
                if ancestor.has_setup_stones():
                    break
                if ancestor.get_move()[0]:
                    moves += 1
                ancestor = ancestor.parent
                if ancestor is not None:
                    previous = self.adapter.context(self.revision, self.adapter.ids[ancestor])
                    if signs == previous.board_state.sign_map:
                        raise ValueError('劫争禁着：不能立即还原重复局面')
                if simple and moves >= 1:
                    break
        for child in parent:
            if child.get_move() == (context.to_play.lower(), pos):
                return self.navigate('node', self.adapter.ids[child]), False
        self.remember()
        node = parent.new_child()
        node.set_move(context.to_play.lower(), pos)
        self.adapter.reindex(context.node_id)
        self.adapter.game.current_node = self.adapter.ids[node]
        self.reset_markers()
        return self.context(), True
