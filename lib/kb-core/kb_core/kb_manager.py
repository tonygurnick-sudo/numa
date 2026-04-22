"""Knowledge Base management utilities for split user KBs."""

import os
import uuid
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any, Dict, List, Optional

import structlog

from prm import client as prm_client

logger = structlog.get_logger()

if TYPE_CHECKING:  # Provide local lightweight type defs so CI doesn't need boto3-stubs
    from typing import Mapping, Sequence, TypedDict

    class AttributeValueTypeDef(TypedDict, total=False):
        S: str
        N: str
        BOOL: bool
        B: bytes | bytearray
        SS: Sequence[str]
        NS: Sequence[str]
        BS: Sequence[bytes | bytearray]
        M: "Mapping[str, AttributeValueTypeDef]"
        L: "Sequence[AttributeValueTypeDef]"
        NULL: bool

    # Keep the client untyped for method calls; we only care about item shapes here.
    DynamoDBClient = Any  # type: ignore[assignment]
else:  # Runtime fallbacks
    AttributeValueTypeDef = Dict[str, Any]  # type: ignore[assignment]
    DynamoDBClient = Any  # type: ignore[assignment]


class KnowledgeBaseManager:
    """Manages logical knowledge bases in DynamoDB."""

    def __init__(self, client_name: Optional[str] = None):
        self.client_name = client_name or os.environ.get("CLIENT_NAME", "")
        self.table_name = f"numa-{self.client_name}-knowledge-bases"

        self.dynamodb: DynamoDBClient = prm_client("dynamodb")
        self.tenant_pk = f"TENANT#{self.client_name}"

    @staticmethod
    def _compute_visibility(
        viewers: List[str], editors: List[str], created_by: Optional[str]
    ) -> Dict[str, bool]:
        """Return visibility flags derived from memberships."""
        is_public = "*" in viewers

        # Personal if only the creator is present (after wildcard excluded)
        members = set([v for v in viewers if v != "*"] + editors)
        if created_by:
            members.discard(created_by)
        is_shared = is_public or len(members) > 0

        return {"is_shared": is_shared, "is_public": is_public}

    def create_kb(
        self,
        name: str,
        created_by: str,
        viewers: List[str],
        editors: List[str],
    ) -> Dict[str, Any]:
        """
        Create a new knowledge base.

        Args:
            name: KB display name (must be unique per tenant)
            created_by: User ID creating the KB
            viewers: List of user_ids or ["*"] for all
            editors: List of user_ids with edit permission

        Returns:
            KB record dict
        """
        # Generate unique ID
        kb_id = str(uuid.uuid4())
        s3_prefix = f"documents/kb-{kb_id}/"
        now = datetime.now(timezone.utc).isoformat()

        # Validate name uniqueness
        if self._kb_name_exists(name):
            raise ValueError(f"KB name '{name}' already exists")

        # Normalise viewer/editor lists
        normalized_viewers = self._normalize_id_list(viewers, allow_wildcard=True)
        normalized_editors = self._normalize_id_list(editors, allow_wildcard=True)

        if created_by:
            if "*" not in normalized_viewers and created_by not in normalized_viewers:
                normalized_viewers.append(created_by)
            if "*" not in normalized_editors and created_by not in normalized_editors:
                normalized_editors.append(created_by)

        # Final de-duplication (handles creator additions)
        normalized_viewers = self._normalize_id_list(
            normalized_viewers, allow_wildcard=True
        )
        normalized_editors = self._normalize_id_list(
            normalized_editors, allow_wildcard=True
        )

        viewers_attribute: AttributeValueTypeDef = (
            {"SS": normalized_viewers} if normalized_viewers else {"L": []}
        )
        editors_attribute: AttributeValueTypeDef = (
            {"SS": normalized_editors} if normalized_editors else {"L": []}
        )

        kb_item: Dict[str, AttributeValueTypeDef] = {
            "PK": {"S": self.tenant_pk},
            "SK": {"S": f"KB#{kb_id}"},
            "kb_id": {"S": kb_id},
            "kb_name": {"S": name},
            "s3_prefix": {"S": s3_prefix},
            "is_default": {"BOOL": False},
            "viewers": viewers_attribute,
            "editors": editors_attribute,
            "created_by": {"S": created_by},
            "created_at": {"S": now},
            "updated_at": {"S": now},
            "status": {"S": "ACTIVE"},
        }

        self.dynamodb.put_item(TableName=self.table_name, Item=kb_item)

        # Create user-KB membership records for GSI
        self._create_memberships(kb_id, name, normalized_viewers, normalized_editors)

        # Ensure the creator is recorded as OWNER in memberships for quick lookup
        try:
            if created_by:
                owner_membership: Dict[str, AttributeValueTypeDef] = {
                    "PK": {"S": self.tenant_pk},
                    "SK": {"S": f"KBMEM#{kb_id}#USER#{created_by}"},
                    "GSI1PK": {"S": f"USER#{created_by}"},
                    "GSI1SK": {"S": f"KB#{kb_id}"},
                    "kb_id": {"S": kb_id},
                    "kb_name": {"S": name},
                    "role": {"S": "OWNER"},
                }
                self.dynamodb.put_item(TableName=self.table_name, Item=owner_membership)
        except Exception as e:
            logger.error(
                "Error creating owner membership",
                kb_id=kb_id,
                user_id=created_by,
                error=str(e),
            )

        logger.info("Created KB", kb_id=kb_id, kb_name=name)
        return self._parse_kb_item(kb_item)

    def _ensure_company_kb_exists(self) -> Optional[Dict[str, Any]]:
        """
        Ensure the default company KB exists, creating it if necessary.

        This provides a resilient fallback for stacks deployed before the
        seed-default-kb Lambda was added, or where the seeding failed.

        Returns:
            The company KB record if created/exists, None on error.
        """
        try:
            # Check if company KB already exists
            response = self.dynamodb.get_item(
                TableName=self.table_name,
                Key={"PK": {"S": self.tenant_pk}, "SK": {"S": "KB#company"}},
            )
            if response.get("Item"):
                return self._parse_kb_item(response["Item"])

            # Company KB doesn't exist - create it
            logger.info(
                "Company KB not found, creating default",
                client_name=self.client_name,
                table_name=self.table_name,
            )

            now = datetime.now(timezone.utc).isoformat()
            kb_item: Dict[str, AttributeValueTypeDef] = {
                "PK": {"S": self.tenant_pk},
                "SK": {"S": "KB#company"},
                "kb_id": {"S": "company"},
                "kb_name": {"S": "Company Knowledge Base"},
                "s3_prefix": {"S": "documents/company/"},
                "is_default": {"BOOL": True},
                "viewers": {"SS": ["*"]},  # All users can view
                "editors": {"L": []},
                "created_by": {"S": "system"},
                "created_at": {"S": now},
                "updated_at": {"S": now},
                "status": {"S": "ACTIVE"},
                "document_count": {"N": "0"},
            }

            self.dynamodb.put_item(TableName=self.table_name, Item=kb_item)
            logger.info(
                "Company KB created successfully",
                client_name=self.client_name,
            )

            return self._parse_kb_item(kb_item)

        except Exception as e:
            logger.error(
                "Error ensuring company KB exists",
                client_name=self.client_name,
                error=str(e),
            )
            return None

    @staticmethod
    def _synthesize_root_kb(user_id: str) -> Dict[str, Any]:
        """Synthesize a virtual root KB record for a user's root files."""
        return {
            "kb_id": user_id,
            "kb_name": "My Files",
            "s3_prefix": f"documents/kb-{user_id}/",
            "status": "ACTIVE",
            "is_root": True,
            "created_by": user_id,
            "viewers": [user_id],
            "editors": [user_id],
        }

    @staticmethod
    def is_root_kb_id(kb_id: str) -> bool:
        """Check if kb_id looks like a Cognito user sub (UUID v4 format)."""
        # Cognito subs are UUID v4: 8-4-4-4-12 hex chars
        import re

        return bool(
            re.match(
                r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
                kb_id,
                re.IGNORECASE,
            )
        )

    def get_kb(self, kb_id: str) -> Optional[Dict[str, Any]]:
        """Get KB by ID. Auto-creates company KB if missing."""
        try:
            response = self.dynamodb.get_item(
                TableName=self.table_name,
                Key={"PK": {"S": self.tenant_pk}, "SK": {"S": f"KB#{kb_id}"}},
            )
            item = response.get("Item")

            # If company KB doesn't exist, auto-create it
            if not item and kb_id == "company":
                return self._ensure_company_kb_exists()

            # If no DynamoDB record and kb_id looks like a user sub,
            # synthesize a virtual root KB record
            if not item and self.is_root_kb_id(kb_id):
                return self._synthesize_root_kb(kb_id)

            return self._parse_kb_item(item) if item else None
        except Exception as e:
            logger.error("Error getting KB", kb_id=kb_id, error=str(e))
            return None

    def list_kbs(self) -> List[Dict[str, Any]]:
        """List all KBs for this tenant."""
        try:
            response = self.dynamodb.query(
                TableName=self.table_name,
                KeyConditionExpression="PK = :pk AND begins_with(SK, :sk)",
                ExpressionAttributeValues={
                    ":pk": {"S": self.tenant_pk},
                    ":sk": {"S": "KB#"},
                },
            )
            kbs = [self._parse_kb_item(item) for item in response.get("Items", [])]
            return [kb for kb in kbs if kb.get("status") != "ARCHIVED"]
        except Exception as e:
            logger.error("Error listing KBs", error=str(e))
            return []

    def list_user_kbs(self, user_id: str) -> List[Dict[str, Any]]:
        """
        List all KBs a user can view (via GSI).

        Returns list of {kb_id, kb_name, role} dicts.
        """
        memberships: Dict[str, Dict[str, Any]] = {}

        try:
            response = self.dynamodb.query(
                TableName=self.table_name,
                IndexName="GSI1",
                KeyConditionExpression="GSI1PK = :pk",
                ExpressionAttributeValues={":pk": {"S": f"USER#{user_id}"}},
            )
            for item in response.get("Items", []):
                parsed = self._parse_membership_item(item)
                memberships[parsed["kb_id"]] = parsed
        except Exception as e:
            logger.error(
                "Error listing user KB memberships", user_id=user_id, error=str(e)
            )

        try:
            tenant_kbs = self.list_kbs()
        except Exception as e:  # pragma: no cover - defensive
            logger.error("Error loading tenant KBs", error=str(e))
            tenant_kbs = []

        for kb in tenant_kbs:
            kb_id = kb.get("kb_id")
            if not kb_id:
                continue

            if kb.get("status") != "ACTIVE":
                continue

            editors = kb.get("editors", [])
            viewers = kb.get("viewers", [])
            visibility = self._compute_visibility(
                viewers, editors, kb.get("created_by")
            )

            role: Optional[str] = None
            # Owner takes precedence over editor/viewer
            if kb.get("created_by") == user_id:
                role = "OWNER"
            elif "*" in editors or user_id in editors:
                role = "EDITOR"
            elif "*" in viewers or user_id in viewers:
                role = "VIEWER"

            if role:
                # If a membership exists but this user is the owner, override to OWNER
                if kb_id in memberships:
                    if role == "OWNER":
                        memberships[kb_id]["role"] = "OWNER"
                    memberships[kb_id]["is_shared"] = visibility["is_shared"]
                    memberships[kb_id]["is_public"] = visibility["is_public"]
                    memberships[kb_id]["kb_name"] = kb.get("kb_name", kb_id)
                    memberships[kb_id]["document_count"] = kb.get("document_count")
                else:
                    memberships[kb_id] = {
                        "kb_id": kb_id,
                        "kb_name": kb.get("kb_name", kb_id),
                        "role": role,
                        "is_shared": visibility["is_shared"],
                        "is_public": visibility["is_public"],
                        "document_count": kb.get("document_count"),
                    }

        # Always include the user's root KB (virtual, no DynamoDB record).
        # Root KB uses user_sub as kb_id for deterministic per-user root storage.
        if user_id not in memberships:
            memberships[user_id] = {
                "kb_id": user_id,
                "kb_name": "My Files",
                "role": "OWNER",
                "is_shared": False,
                "is_public": False,
                "is_root": True,
                "document_count": None,
            }

        return sorted(
            memberships.values(),
            key=lambda item: item["kb_name"].lower() if item.get("kb_name") else "",
        )

    def check_permission(
        self, kb_id: str, user_id: str, required_role: str = "VIEWER"
    ) -> bool:
        """
        Check if user has permission for KB.

        Args:
            kb_id: KB ID
            user_id: User ID
            required_role: 'VIEWER' or 'EDITOR'

        Returns:
            True if user has permission
        """
        kb = self.get_kb(kb_id)
        if not kb:
            return False

        # Owner (creator) has all permissions
        if kb.get("created_by") == user_id:
            return True

        # Check viewers
        viewers = kb.get("viewers", [])
        if "*" in viewers or user_id in viewers:
            if required_role == "VIEWER":
                return True

        # Check editors (editors can also view)
        editors = kb.get("editors", [])
        if "*" in editors or user_id in editors:
            return True

        return False

    def check_owner(self, kb_id: str, user_id: str) -> bool:
        """Return True if the user is the owner (creator) of the KB.

        Backward-compatibility fallback: if created_by is missing/empty on legacy items,
        allow EDITORs to act as owner for protected actions (update/delete).
        """
        kb = self.get_kb(kb_id)
        if not kb:
            return False

        created_by = kb.get("created_by")
        if isinstance(created_by, str) and created_by:
            return created_by == user_id

        # Legacy fallback: no created_by recorded
        editors = kb.get("editors", [])
        return user_id in editors

    def update_kb(
        self,
        kb_id: str,
        name: Optional[str] = None,
        viewers: Optional[List[str]] = None,
        editors: Optional[List[str]] = None,
    ) -> bool:
        """
        Update KB properties.

        Args:
            kb_id: KB ID
            name: New name (optional)
            viewers: New viewers list (optional)
            editors: New editors list (optional)

        Returns:
            True if successful
        """
        try:
            # Get existing KB
            kb = self.get_kb(kb_id)
            if not kb:
                return False

            # Build update expression
            update_parts = []
            expr_attr_values: Dict[str, AttributeValueTypeDef] = {}
            expr_attr_names: Dict[str, str] = {}
            creator_id = kb.get("created_by")

            new_viewers_list = kb.get("viewers", []) or []
            new_editors_list = kb.get("editors", []) or []

            if name is not None and name != kb["kb_name"]:
                # Check name uniqueness
                if self._kb_name_exists(name):
                    raise ValueError(f"KB name '{name}' already exists")
                update_parts.append("#name = :name")
                expr_attr_values[":name"] = {"S": name}
                expr_attr_names["#name"] = "kb_name"

            if viewers is not None:
                normalized_viewers = self._normalize_id_list(
                    viewers, allow_wildcard=True
                )
                if (
                    creator_id
                    and "*" not in normalized_viewers
                    and creator_id not in normalized_viewers
                ):
                    normalized_viewers.append(creator_id)
                    normalized_viewers = self._normalize_id_list(
                        normalized_viewers, allow_wildcard=True
                    )

                update_parts.append("viewers = :viewers")
                expr_attr_values[":viewers"] = (
                    {"SS": normalized_viewers} if normalized_viewers else {"L": []}
                )
                new_viewers_list = normalized_viewers

            if editors is not None:
                normalized_editors = self._normalize_id_list(
                    editors, allow_wildcard=True
                )
                if creator_id:
                    if (
                        "*" not in normalized_editors
                        and creator_id not in normalized_editors
                    ):
                        normalized_editors.append(creator_id)
                    normalized_editors = self._normalize_id_list(
                        normalized_editors, allow_wildcard=True
                    )

                update_parts.append("editors = :editors")
                expr_attr_values[":editors"] = (
                    {"SS": normalized_editors} if normalized_editors else {"L": []}
                )
                new_editors_list = normalized_editors

            if update_parts:
                update_parts.append("updated_at = :updated_at")
                expr_attr_values[":updated_at"] = {
                    "S": datetime.now(timezone.utc).isoformat()
                }

                update_expr = "SET " + ", ".join(update_parts)

                if expr_attr_names:
                    self.dynamodb.update_item(
                        TableName=self.table_name,
                        Key={
                            "PK": {"S": self.tenant_pk},
                            "SK": {"S": f"KB#{kb_id}"},
                        },
                        UpdateExpression=update_expr,
                        ExpressionAttributeValues=expr_attr_values,
                        ExpressionAttributeNames=expr_attr_names,
                    )
                else:
                    self.dynamodb.update_item(
                        TableName=self.table_name,
                        Key={
                            "PK": {"S": self.tenant_pk},
                            "SK": {"S": f"KB#{kb_id}"},
                        },
                        UpdateExpression=update_expr,
                        ExpressionAttributeValues=expr_attr_values,
                    )

                # Update memberships if viewers/editors changed
                if viewers is not None or editors is not None:
                    self._update_memberships(
                        kb_id,
                        name or kb["kb_name"],
                        new_viewers_list,
                        new_editors_list,
                    )

                logger.info("Updated KB", kb_id=kb_id)
                return True

            return False

        except Exception as e:
            logger.error("Error updating KB", kb_id=kb_id, error=str(e))
            return False

    def delete_kb(self, kb_id: str) -> bool:
        """
        Soft-delete a KB (set status to ARCHIVED).

        Args:
            kb_id: KB ID

        Returns:
            True if successful
        """
        try:
            self.dynamodb.update_item(
                TableName=self.table_name,
                Key={"PK": {"S": self.tenant_pk}, "SK": {"S": f"KB#{kb_id}"}},
                UpdateExpression="SET #status = :status, updated_at = :updated_at",
                ExpressionAttributeNames={"#status": "status"},
                ExpressionAttributeValues={
                    ":status": {"S": "ARCHIVED"},
                    ":updated_at": {"S": datetime.now(timezone.utc).isoformat()},
                },
            )
            self._delete_memberships(kb_id)
            logger.info("Archived KB", kb_id=kb_id)
            return True
        except Exception as e:
            logger.error("Error deleting KB", kb_id=kb_id, error=str(e))
            return False

    def update_document_count(self, kb_id: str, count: int) -> bool:
        """
        Update the document count for a KB.

        Args:
            kb_id: KB ID
            count: New document count

        Returns:
            True if successful
        """
        # Root KBs have no DynamoDB record -- skip count update
        if self.is_root_kb_id(kb_id):
            # Check if this is actually a regular KB with a UUID id
            try:
                response = self.dynamodb.get_item(
                    TableName=self.table_name,
                    Key={"PK": {"S": self.tenant_pk}, "SK": {"S": f"KB#{kb_id}"}},
                    ProjectionExpression="kb_id",
                )
                if "Item" not in response:
                    return True  # Root KB, nothing to update
            except Exception:
                return True  # Fail gracefully for root KBs
        try:
            self.dynamodb.update_item(
                TableName=self.table_name,
                Key={"PK": {"S": self.tenant_pk}, "SK": {"S": f"KB#{kb_id}"}},
                UpdateExpression="SET document_count = :count",
                ExpressionAttributeValues={":count": {"N": str(count)}},
            )
            logger.debug("Updated document count", kb_id=kb_id, count=count)
            return True
        except Exception as e:
            logger.error(
                "Error updating document count", kb_id=kb_id, count=count, error=str(e)
            )
            return False

    def _kb_name_exists(self, name: str) -> bool:
        """Check if KB name already exists (excluding ARCHIVED KBs)."""
        try:
            response = self.dynamodb.query(
                TableName=self.table_name,
                KeyConditionExpression="PK = :pk AND begins_with(SK, :sk)",
                ExpressionAttributeValues={
                    ":pk": {"S": self.tenant_pk},
                    ":sk": {"S": "KB#"},
                },
            )
            for item in response.get("Items", []):
                # Skip archived KBs
                if item.get("status", {}).get("S") == "ARCHIVED":
                    continue
                if item.get("kb_name", {}).get("S") == name:
                    return True
            return False
        except Exception as e:
            logger.error("Error checking KB name", name=name, error=str(e))
            return False

    def _create_memberships(
        self, kb_id: str, kb_name: str, viewers: List[str], editors: List[str]
    ):
        """Create user-KB membership records for GSI queries."""
        members = {}

        # Add viewers
        for user_id in viewers:
            if user_id != "*":
                members[user_id] = "VIEWER"

        # Add editors (overrides viewer)
        for user_id in editors:
            if user_id != "*":
                members[user_id] = "EDITOR"

        # Write membership records
        for user_id, role in members.items():
            membership_item: Dict[str, AttributeValueTypeDef] = {
                "PK": {"S": self.tenant_pk},
                "SK": {"S": f"KBMEM#{kb_id}#USER#{user_id}"},
                "GSI1PK": {"S": f"USER#{user_id}"},
                "GSI1SK": {"S": f"KB#{kb_id}"},
                "kb_id": {"S": kb_id},
                "kb_name": {"S": kb_name},
                "role": {"S": role},
            }
            try:
                self.dynamodb.put_item(TableName=self.table_name, Item=membership_item)
            except Exception as e:
                logger.error(
                    "Error creating membership",
                    kb_id=kb_id,
                    user_id=user_id,
                    error=str(e),
                )

    def _delete_memberships(self, kb_id: str):
        """Delete all membership records for a KB."""
        try:
            response = self.dynamodb.query(
                TableName=self.table_name,
                KeyConditionExpression="PK = :pk AND begins_with(SK, :sk)",
                ExpressionAttributeValues={
                    ":pk": {"S": self.tenant_pk},
                    ":sk": {"S": f"KBMEM#{kb_id}#"},
                },
            )
            for item in response.get("Items", []):
                self.dynamodb.delete_item(
                    TableName=self.table_name,
                    Key={"PK": item["PK"], "SK": item["SK"]},
                )
        except Exception as e:
            logger.error("Error deleting memberships", kb_id=kb_id, error=str(e))

    def _update_memberships(
        self, kb_id: str, kb_name: str, viewers: List[str], editors: List[str]
    ):
        """Update user-KB membership records (delete old, create new)."""
        self._delete_memberships(kb_id)

        # Create new memberships
        self._create_memberships(kb_id, kb_name, viewers, editors)

    def _normalize_id_list(
        self, items: Optional[List[str]], allow_wildcard: bool = False
    ) -> List[str]:
        """Normalise user identifier lists (dedupe, strip blanks, handle wildcards)."""
        if not items:
            return []

        normalized: List[str] = []
        seen = set()

        for raw in items:
            if raw is None:
                continue
            value = raw.strip() if isinstance(raw, str) else str(raw).strip()
            if not value:
                continue

            if allow_wildcard and value == "*":
                return ["*"]

            if value not in seen:
                normalized.append(value)
                seen.add(value)

        return normalized

    def _parse_kb_item(self, item: Dict) -> Dict[str, Any]:
        """Parse DynamoDB KB item to dict."""
        # Handle both SS (String Set) and L (List) for viewers/editors
        viewers_value = item.get("viewers", {})
        if "SS" in viewers_value:
            viewers = list(viewers_value["SS"])
        elif "L" in viewers_value:
            viewers = []
        else:
            viewers = []

        editors_value = item.get("editors", {})
        if "SS" in editors_value:
            editors = list(editors_value["SS"])
        elif "L" in editors_value:
            editors = []
        else:
            editors = []

        created_by = item.get("created_by", {}).get("S")
        visibility = self._compute_visibility(viewers, editors, created_by)

        return {
            "kb_id": item["kb_id"]["S"],
            "kb_name": item["kb_name"]["S"],
            "s3_prefix": item["s3_prefix"]["S"],
            "is_default": item.get("is_default", {}).get("BOOL", False),
            "viewers": viewers,
            "editors": editors,
            "created_by": created_by,
            "created_at": item.get("created_at", {}).get("S"),
            "status": item["status"]["S"],
            "document_count": (
                int(item["document_count"]["N"])
                if item.get("document_count", {}).get("N")
                else None
            ),
            "is_shared": visibility["is_shared"],
            "is_public": visibility["is_public"],
        }

    def _parse_membership_item(self, item: Dict) -> Dict[str, Any]:
        """Parse DynamoDB membership item."""
        return {
            "kb_id": item["kb_id"]["S"],
            "kb_name": item["kb_name"]["S"],
            "role": item["role"]["S"],
        }
