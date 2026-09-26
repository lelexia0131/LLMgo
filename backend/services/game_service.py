from backend.domain.context import GameContext
from backend.domain.move import BoardMarker, point
from backend.sgf.adapter import SGFAdapter


class GameService:
    def __init__(self) -> None:
        self.adapter = SGFAdapter()
        self.revision = 0
        self.markers: list[BoardMarker] = []
        self.selected: str | None = None
        self.filename: str | None = None

    def context(self) -> GameContext:
        context = self.adapter.context(self.revision)
        context.markers = list(self.markers)
        context.selected_move = self.selected
        context.filename = self.filename
        return context

    def check(self, revision: int) -> None:
        if revision != self.revision:
            raise ValueError('局面或标记已改变，请重新操作')

    def open(self, data: bytes, filename: str | None) -> GameContext:
        adapter = SGFAdapter(data)
        adapter.context(0)  # Validate before replacing the current record.
        self.adapter, self.filename = adapter, filename
        self.reset_markers()
        return self.context()

    def reset_markers(self) -> None:
        self.markers = []
        self.selected = None
        self.revision += 1

    def navigate(self, direction: str, node_id: str | None = None) -> GameContext:
        game = self.adapter.game
        current = game.nodes[int(game.current_node)]
        target = game.current_node
        if direction == 'first':
            target = '0'
        elif direction == 'previous':
            target = current.parent_id or '0'
        elif direction == 'next' and current.children:
            target = current.children[0]
        elif direction == 'last':
            while current.children:
                current = game.nodes[int(current.children[0])]
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

    def select(self, coordinate: str, revision: int) -> GameContext:
        self.check(revision)
        context = self.context()
        pos = point(coordinate, context.board_state.size)
        coordinate = coordinate.upper() if pos else 'pass'
        existing = next((m for m in self.markers if m.coordinate == coordinate), None)
        if existing is None:
            if len(self.markers) >= 5:
                raise ValueError('最多显示 5 个标记，请先清除标记')
            role = 'stone' if pos and context.board_state.sign_map[context.board_state.size - 1 - pos[0]][pos[1]] else 'selected_move'
            self.markers.append(BoardMarker(id=len(self.markers) + 1, coordinate=coordinate, role=role))
        self.selected = coordinate
        self.revision += 1
        return self.context()
