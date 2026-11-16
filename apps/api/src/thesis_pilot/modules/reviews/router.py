from typing import Annotated, Literal
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from thesis_pilot.api.dependencies import get_session
from thesis_pilot.modules.reviews import service
from thesis_pilot.modules.reviews.schemas import (
    ReviewCreate,
    ReviewPage,
    ReviewRead,
    ReviewReceipt,
    ReviewReportRead,
    ReviewRetry,
    ReviewRubricRead,
)

router = APIRouter(tags=["reviews"])
SessionDependency = Annotated[Session, Depends(get_session)]


@router.get("/review-rubrics", response_model=list[ReviewRubricRead])
def list_rubrics() -> list[ReviewRubricRead]:
    return service.list_rubrics()


@router.post("/projects/{project_id}/reviews", response_model=ReviewReceipt, status_code=202)
def create_review(
    project_id: UUID, data: ReviewCreate, session: SessionDependency
) -> ReviewReceipt:
    return service.create_review(session, project_id, data)


@router.get("/projects/{project_id}/reviews", response_model=ReviewPage)
def list_reviews(
    project_id: UUID,
    session: SessionDependency,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> ReviewPage:
    return service.list_reviews(session, project_id, limit=limit, offset=offset)


@router.get("/projects/{project_id}/reviews/{review_id}", response_model=ReviewRead)
def get_review(project_id: UUID, review_id: UUID, session: SessionDependency) -> ReviewRead:
    return service.get_review(session, project_id, review_id)


@router.post("/projects/{project_id}/reviews/{review_id}/cancel", response_model=ReviewRead)
def cancel_review(project_id: UUID, review_id: UUID, session: SessionDependency) -> ReviewRead:
    return service.cancel_review(session, project_id, review_id)


@router.post(
    "/projects/{project_id}/reviews/{review_id}/retry",
    response_model=ReviewReceipt,
    status_code=202,
)
def retry_review(
    project_id: UUID, review_id: UUID, data: ReviewRetry, session: SessionDependency
) -> ReviewReceipt:
    return service.retry_review(session, project_id, review_id, data)


@router.get("/projects/{project_id}/reviews/{review_id}/report", response_model=ReviewReportRead)
def get_report(project_id: UUID, review_id: UUID, session: SessionDependency) -> ReviewReportRead:
    return service.get_report(session, project_id, review_id)


@router.get("/projects/{project_id}/reviews/{review_id}/report/download")
def download_report(
    project_id: UUID,
    review_id: UUID,
    session: SessionDependency,
    format: Literal["html", "markdown"] = "html",
) -> Response:
    filename, media, body = service.download_report(session, project_id, review_id, format)
    return Response(
        body,
        media_type=media,
        headers={
            "Content-Disposition": (
                f"attachment; filename=\"{filename}\"; filename*=UTF-8''{quote(filename)}"
            ),
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "no-store",
        },
    )
