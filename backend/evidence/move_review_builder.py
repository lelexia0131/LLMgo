from backend.domain.review import MoveReview
from backend.evidence.schemas import MoveReviewEvidence


def build_move_review_evidence(review: MoveReview) -> MoveReviewEvidence:
    return MoveReviewEvidence(**review.model_dump(), perspective=review.player)
