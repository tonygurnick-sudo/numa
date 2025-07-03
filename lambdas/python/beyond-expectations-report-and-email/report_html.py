# report_html.py

import json
import os
from collections import defaultdict
from html import escape
from typing import Any, Dict, List

from jinja2 import Environment, FileSystemLoader

import timezone_utils


def safe_escape(value) -> str:
    """Safely escape HTML content, handling different data types.

    Args:
        value: The value to escape (can be str, int, float, None, etc.)

    Returns:
        HTML-escaped string, or empty string for None values
    """
    if value is None:
        return ""

    # Convert to string first, then escape
    return escape(str(value))


def load_template_files():
    """Load external template files (CSS, JS, HTML) for report generation.

    Returns:
        Dictionary containing loaded file contents
    """
    # Get the directory containing this module
    current_dir = os.path.dirname(os.path.abspath(__file__))
    templates_dir = os.path.join(current_dir, "templates")

    # Set up Jinja2 environment
    env = Environment(loader=FileSystemLoader(templates_dir))

    # Load CSS content
    css_file_path = os.path.join(templates_dir, "css", "report_styles.css")
    with open(css_file_path, "r", encoding="utf-8") as f:
        css_content = f.read()

    # Load JavaScript files
    summary_js_path = os.path.join(templates_dir, "js", "summary_report.js")
    with open(summary_js_path, "r", encoding="utf-8") as f:
        summary_js_content = f.read()

    notifications_js_path = os.path.join(templates_dir, "js", "notifications_report.js")
    with open(notifications_js_path, "r", encoding="utf-8") as f:
        notifications_js_content = f.read()

    # Load HTML templates
    summary_template = env.get_template("summary_report.html")
    notifications_template = env.get_template("notifications_report.html")

    return {
        "css_content": css_content,
        "summary_js_content": summary_js_content,
        "notifications_js_content": notifications_js_content,
        "summary_template": summary_template,
        "notifications_template": notifications_template,
    }


def generate_summary_report_html(
    start_time_str: str,
    end_time_str: str,
    analysis_result: Dict[str, Any],
    notif_sets: Dict[str, Dict[str, List[Dict[str, Any]]]],
) -> str:
    """
    Build the HTML error-analysis summary report with charts and statistics.
    """
    # Load template files
    templates = load_template_files()

    # Get summary sections and error categories directly
    error_categories = analysis_result.get("error_categories", {})
    summary_sections = analysis_result.get("summary_sections", {})

    # Ensure summary sections are treated as raw HTML
    def get_summary_section(key: str, default: str) -> str:
        """Get a summary section that preserves HTML formatting"""
        content = summary_sections.get(key)
        if not content:
            return default
        return content

    # Prepare chart data
    all_clients = set()
    client_total: Dict[str, int] = {}
    client_unique: Dict[str, int] = {}
    client_sev: Dict[str, Dict[str, int]] = {"High": {}, "Medium": {}, "Low": {}}
    for n in analysis_result.get("all_results", []):
        log = n.get("log_entry", {})
        cid = log.get("client_id", log.get("ClientId", "unknown"))
        cname = log.get("client_name", log.get("ClientName", "Unknown Client"))
        disp = f"{cname} ({cid})"
        all_clients.add(disp)
        occ = log.get("occurrences", 1)
        client_total[disp] = client_total.get(disp, 0) + occ
        client_unique[disp] = client_unique.get(disp, 0) + 1
        sev = n.get("severity", "Medium")
        if sev in client_sev:
            client_sev[sev][disp] = client_sev[sev].get(disp, 0) + 1

    sorted_clients = sorted(
        all_clients, key=lambda x: client_total.get(x, 0), reverse=True
    )

    # Generate stats content HTML
    current_year = timezone_utils.get_current_nz_time().year
    stats_content = generate_stats_content_html(notif_sets, all_clients, current_year)

    # Prepare template variables
    template_vars = {
        "css_content": templates["css_content"],
        "js_content": templates["summary_js_content"],
        "start_time_str": start_time_str,
        "end_time_str": end_time_str,
        "client_labels": json.dumps(sorted_clients),
        "total_errors_data": json.dumps(
            [client_total.get(c, 0) for c in sorted_clients]
        ),
        "unique_errors_data": json.dumps(
            [client_unique.get(c, 0) for c in sorted_clients]
        ),
        "high_severity_data": json.dumps(
            [client_sev["High"].get(c, 0) for c in sorted_clients]
        ),
        "medium_severity_data": json.dumps(
            [client_sev["Medium"].get(c, 0) for c in sorted_clients]
        ),
        "low_severity_data": json.dumps(
            [client_sev["Low"].get(c, 0) for c in sorted_clients]
        ),
        "summary_overview": get_summary_section(
            "summary", "<p>No overview available.</p>"
        ),
        "summary_trends": get_summary_section(
            "trends_and_patterns", "<p>No trends or patterns identified.</p>"
        ),
        "summary_critical": get_summary_section(
            "critical_issues", "<p>No critical issues identified.</p>"
        ),
        "summary_impact": get_summary_section(
            "business_impact", "<p>No business impact assessment available.</p>"
        ),
        "summary_recommendations": get_summary_section(
            "recommendations", "<p>No recommendations available.</p>"
        ),
        "error_categories": error_categories,
        "stats_content": stats_content,
        "generation_time": timezone_utils.format_nz_datetime(
            timezone_utils.get_current_nz_time()
        ),
        "current_year": timezone_utils.get_current_nz_time().year,
    }

    # Render the template
    return templates["summary_template"].render(**template_vars)


def generate_notifications_report_html(
    start_time_str: str,
    end_time_str: str,
    notif_sets: Dict[str, Dict[str, List[Dict[str, Any]]]],
    mail_to_links: List[Dict[str, Any]],
) -> str:
    """
    Build the HTML error-analysis notifications report with two top-level tabs (New vs Recurring).
    """
    # Load template files
    templates = load_template_files()

    # Generate content for new and recurring notifications
    new_content = render_four_tab_block("new", notif_sets["new"], mail_to_links)
    recurring_content = render_four_tab_block(
        "rec", notif_sets["recurring"], mail_to_links
    )

    # Prepare template variables
    template_vars = {
        "css_content": templates["css_content"],
        "js_content": templates["notifications_js_content"],
        "start_time_str": start_time_str,
        "end_time_str": end_time_str,
        "new_content": new_content,
        "recurring_content": recurring_content,
        "generation_time": timezone_utils.format_nz_datetime(
            timezone_utils.get_current_nz_time()
        ),
        "current_year": timezone_utils.get_current_nz_time().year,
    }

    # Render the template
    return templates["notifications_template"].render(**template_vars)


def generate_stats_content_html(
    notif_sets: Dict[str, Dict[str, List[Dict[str, Any]]]],
    all_clients: set,
    current_year: int,
) -> str:
    """Generate the statistics content HTML for the summary report."""
    return f"""
    <div class="stats-subsection">
        <h4>High Level Stats</h4>
        <div class="stats-grid-3">
            <div class="stat-card">
                <div class="stat-value">{len(notif_sets["new"]["both"] + notif_sets["new"]["client_only"] + notif_sets["new"]["internal"] + notif_sets["new"]["none"]) + len(notif_sets["recurring"]["both"] + notif_sets["recurring"]["client_only"] + notif_sets["recurring"]["internal"] + notif_sets["recurring"]["none"])}</div>
                <div class="stat-label">Total Unique Errors</div>
            </div>
            <div class="stat-card">
                <div class="stat-value new-errors">{len(notif_sets["new"]["both"] + notif_sets["new"]["client_only"] + notif_sets["new"]["internal"] + notif_sets["new"]["none"])}</div>
                <div class="stat-label">New Errors</div>
            </div>
            <div class="stat-card">
                <div class="stat-value recurring-errors">{len(notif_sets["recurring"]["both"] + notif_sets["recurring"]["client_only"] + notif_sets["recurring"]["internal"] + notif_sets["recurring"]["none"])}</div>
                <div class="stat-label">Recurring Errors (Last 30 days)</div>
            </div>
        </div>

        <div class="stats-grid-3">
          <div class="stat-card">
            <div class="stat-value new-errors">{len(notif_sets["new"]["both"] + notif_sets["new"]["client_only"] + notif_sets["new"]["internal"])}</div>
            <div class="stat-label">New Errors Requiring Notification</div>
          </div>
          <div class="stat-card">
            <div class="stat-value recurring-errors">{len(notif_sets["recurring"]["both"] + notif_sets["recurring"]["client_only"] + notif_sets["recurring"]["internal"])}</div>
            <div class="stat-label">Recurring Errors Requiring Notification</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">{len(all_clients)}</div>
            <div class="stat-label">Clients Affected</div>
          </div>
        </div>
      </div>

      <div class="stats-subsection">
        <h4>Error Notifications</h4>
        <div class="subsection-title new-errors">New Errors</div>
        <div class="stats-grid-3">
          <div class="stat-card">
            <div class="stat-value new-errors">{len(notif_sets["new"]["both"])}</div>
            <div class="stat-label">Client & Internal</div>
          </div>
          <div class="stat-card">
            <div class="stat-value new-errors">{len(notif_sets["new"]["client_only"])}</div>
            <div class="stat-label">Client Only</div>
          </div>
          <div class="stat-card">
            <div class="stat-value new-errors">{len(notif_sets["new"]["internal"])}</div>
            <div class="stat-label">Internal Only</div>
          </div>
        </div>

        <div class="subsection-title recurring-errors">Recurring Errors (Occurring in the last 30 days)</div>
        <div class="stats-grid-3">
          <div class="stat-card">
            <div class="stat-value recurring-errors">{len(notif_sets["recurring"]["both"])}</div>
            <div class="stat-label">Client & Internal</div>
          </div>
          <div class="stat-card">
            <div class="stat-value recurring-errors">{len(notif_sets["recurring"]["client_only"])}</div>
            <div class="stat-label">Client Only</div>
          </div>
          <div class="stat-card">
            <div class="stat-value recurring-errors">{len(notif_sets["recurring"]["internal"])}</div>
            <div class="stat-label">Internal Only</div>
          </div>
        </div>
      </div>

      <div class="stats-subsection">
        <h4>Error Severity</h4>

        <div class="subsection-title new-errors">New Errors</div>
        <div class="stats-grid-3">
          <div class="stat-card">
            <div class="stat-value" style="color: #B91C1C;">{sum(1 for n in notif_sets["new"]["both"] + notif_sets["new"]["client_only"] + notif_sets["new"]["internal"] + notif_sets["new"]["none"] if n.get('severity') == 'High')}</div>
            <div class="stat-label">High Severity</div>
          </div>
          <div class="stat-card">
            <div class="stat-value" style="color: #C2410C;">{sum(1 for n in notif_sets["new"]["both"] + notif_sets["new"]["client_only"] + notif_sets["new"]["internal"] + notif_sets["new"]["none"] if n.get('severity') == 'Medium')}</div>
            <div class="stat-label">Medium Severity</div>
          </div>
          <div class="stat-card">
            <div class="stat-value" style="color: #047857;">{sum(1 for n in notif_sets["new"]["both"] + notif_sets["new"]["client_only"] + notif_sets["new"]["internal"] + notif_sets["new"]["none"] if n.get('severity') == 'Low')}</div>
            <div class="stat-label">Low Severity</div>
          </div>
        </div>

        <div class="subsection-title recurring-errors">Recurring Errors (Last 30 days)</div>
        <div class="stats-grid-3">
          <div class="stat-card">
            <div class="stat-value recurring-errors" style="color: #B91C1C;">{sum(1 for n in notif_sets["recurring"]["both"] + notif_sets["recurring"]["client_only"] + notif_sets["recurring"]["internal"] + notif_sets["recurring"]["none"] if n.get('severity') == 'High')}</div>
            <div class="stat-label">High Severity</div>
          </div>
          <div class="stat-card">
            <div class="stat-value recurring-errors" style="color: #C2410C;">{sum(1 for n in notif_sets["recurring"]["both"] + notif_sets["recurring"]["client_only"] + notif_sets["recurring"]["internal"] + notif_sets["recurring"]["none"] if n.get('severity') == 'Medium')}</div>
            <div class="stat-label">Medium Severity</div>
          </div>
          <div class="stat-card">
            <div class="stat-value recurring-errors" style="color: #047857;">{sum(1 for n in notif_sets["recurring"]["both"] + notif_sets["recurring"]["client_only"] + notif_sets["recurring"]["internal"] + notif_sets["recurring"]["none"] if n.get('severity') == 'Low')}</div>
            <div class="stat-label">Low Severity</div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Charts -->
  <div class="chart-container">
    <div class="chart-header">
      <div class="chart-title">Total Error Occurrences by Client</div>
      <div class="chart-controls">
        <button id="total-all-filter" class="filter-button total-filter-button active" onclick="updateTotalErrorsChart('all')">All Errors</button>
        <button id="total-severity-filter" class="filter-button total-filter-button" onclick="updateTotalErrorsChart('severity')">By Severity</button>
      </div>
    </div>
    <div class="chart-body"><canvas id="totalErrorsChart"></canvas></div>
  </div>
  <div class="chart-container">
    <div class="chart-header">
      <div class="chart-title">Unique Errors by Client</div>
      <div class="chart-controls">
        <button id="unique-all-filter" class="filter-button unique-filter-button active" onclick="updateUniqueErrorsChart('all')">All Errors</button>
        <button id="unique-severity-filter" class="filter-button unique-filter-button" onclick="updateUniqueErrorsChart('severity')">By Severity</button>
      </div>
    </div>
    <div class="chart-body"><canvas id="uniqueErrorsChart"></canvas></div>
  </div>

  <div style="margin-top:40px;padding-top:20px;border-top:1px solid #E5E7EB;font-size:0.9em;color:#6B7280;text-align:center;">
    <p>Generated by Beyond Expectations Error Monitoring System on {timezone_utils.format_nz_datetime(timezone_utils.get_current_nz_time())}</p>
    <p>© {current_year} Arcanum AI. All rights reserved.</p>
  </div>
</body>
</html>"""


def render_four_tab_block(
    prefix: str,
    bundle: Dict[str, List[Dict[str, Any]]],
    mail_to_links: List[Dict[str, Any]],
) -> str:
    """Render the four-tab block for new/recurring notifications."""
    both = bundle["both"]
    client = bundle["client_only"]
    internal = bundle["internal"]
    none = bundle["none"]
    grp_both = group_notifications_by_client(both)
    grp_client = group_notifications_by_client(client)
    grp_internal = group_notifications_by_client(internal)
    grp_none = group_notifications_by_client(none)
    counts = {
        "both": len(both),
        "client": len(client),
        "internal": len(internal),
        "none": len(none),
    }

    def banner_text(key):
        return {
            "both": "These errors have been flagged for notification to both the client and the Beyond Expectations team.",
            "client": "These errors have been flagged for client notification only.",
            "internal": "These errors have been flagged for internal Beyond Expectations team notification only.",
            "none": "These errors don't require notification to either clients or the Beyond Expectations team.",
        }[key]

    # Generate the HTML for the four-tab structure
    html = []
    # labels
    html.append("<div class='tab-labels'>")
    for idx, (code, label) in enumerate(
        [
            ("both", "Both Client & BE"),
            ("client", "Client Only"),
            ("internal", "BE Internal Only"),
            ("none", "No Notification"),
        ],
        start=1,
    ):
        act = " active" if idx == 1 else ""
        html.append(
            f"<button id='{prefix}-tab{idx}-label' class='tab-label{act}' onclick=\"showTab('{prefix}-tab{idx}')\">{label} <span class='count'>{counts[code]}</span></button>"
        )
    html.append("</div>")
    # contents
    # pylint: disable=too-many-nested-blocks
    for idx, (code, grouped) in enumerate(
        [
            ("both", grp_both),
            ("client", grp_client),
            ("internal", grp_internal),
            ("none", grp_none),
        ],
        start=1,
    ):
        style = "style='display:block;'" if idx == 1 else ""
        html.append(f"<div id='{prefix}-tab{idx}' class='tab-content' {style}>")
        html.append(
            f"<div class='info-banner'><div class='info-icon'>i</div><div class='info-content'>{banner_text(code)}</div></div>"
        )
        # filters...
        html.append(
            f"<div class='filters-container'><div class='filter-group'><div class='filter-label'>Client:</div><select id='{prefix}-tab{idx}-client-filter' class='filter-select' onchange=\"applyFilters('{prefix}-tab{idx}')\"><option value='all'>All Clients</option></select></div><div class='filter-group'><div class='filter-label'>Severity:</div><select id='{prefix}-tab{idx}-severity-filter' class='filter-select' onchange=\"applyFilters('{prefix}-tab{idx}')\"><option value='all'>All Severities</option></select></div><button class='filter-reset' onclick=\"resetFilters('{prefix}-tab{idx}')\">Reset Filters</button></div><div class='no-matches-message' style='display:none;'><p>No errors match the selected filters.</p></div>"
        )
        if grouped:
            # pylint: disable=too-many-nested-blocks
            for client_id, notifs in grouped.items():
                first = notifs[0]
                log = first.get("log_entry", {})
                cname = log.get("client_name", log.get("ClientName", "Unknown Client"))
                html.append(
                    f"<div class='client-section'><div class='client-section-header'><div>{safe_escape(cname)} (ID: {safe_escape(client_id)})</div><div class='client-error-count'>{len(notifs)} error{'s' if len(notifs)>1 else ''}</div></div><div class='client-section-content'>"
                )
                for n in notifs:
                    sev = n.get("severity", "Medium")
                    sev_cls = (
                        sev.lower() if sev in ("High", "Medium", "Low") else "medium"
                    )
                    badge = f"{sev_cls}-badge"
                    err = n.get("error_type", "Unknown Error")
                    expl = n.get("explanation", "No explanation available")
                    actn = n.get("recommended_action", "No action specified")
                    log = n.get("log_entry", {})
                    task = log.get(
                        "task_description",
                        log.get("TaskDescription", "Unknown Task"),
                    )
                    msg = log.get("message", log.get("Message", "No message available"))
                    occ = log.get("occurrences", 1)
                    first_occ = timezone_utils.parse_and_format_timestamp(
                        log.get("first_occurrence", "Unknown")
                    )
                    last_occ = timezone_utils.parse_and_format_timestamp(
                        log.get("last_occurrence", "Unknown")
                    )
                    mail_to = ""
                    for link in mail_to_links:
                        if (
                            link.get("error_type") == err
                            and link.get("severity") == sev
                        ):
                            mail_to = link.get("mail_to", "")
                            break
                    escaped_mail_to = safe_escape(mail_to) if mail_to else ""
                    mail_to_link = (
                        f'<a href="{escaped_mail_to}" class="mail-to-button">Compose Email to Client</a>'
                        if mail_to
                        else ""
                    )
                    html.append(
                        f"<div class='error-item'><h3><span class='severity-badge {badge}'>{safe_escape(sev)}</span>{safe_escape(err)}</h3><div class='client-info'><strong>Task:</strong> {safe_escape(task)}<br><strong>Occurrences:</strong> {occ}<br><strong>First Occurrence:</strong> {safe_escape(first_occ)}<br><strong>Last Occurrence:</strong> {safe_escape(last_occ)}</div><p><strong>Explanation:</strong> {safe_escape(expl)}</p><p><strong>Recommended Action:</strong> {safe_escape(actn)}</p><div class='error-message'>{safe_escape(msg)}</div>{mail_to_link}</div>"
                    )
                html.append("</div></div>")
        else:
            html.append(
                "<div class='error-item'><em>No errors in this category.</em></div>"
            )
        html.append("</div>")
    return "\n".join(html)


def generate_report_html(
    start_time_str: str,
    end_time_str: str,
    analysis_result: Dict[str, Any],
    notif_sets: Dict[str, Dict[str, List[Dict[str, Any]]]],
    mail_to_links: List[Dict[str, Any]],
) -> Dict[str, str]:
    """
    Generate both summary and notifications HTML reports.
    Returns a dictionary with 'summary' and 'notifications' keys.
    """
    summary_html = generate_summary_report_html(
        start_time_str, end_time_str, analysis_result, notif_sets
    )

    notifications_html = generate_notifications_report_html(
        start_time_str, end_time_str, notif_sets, mail_to_links
    )

    return {"summary": summary_html, "notifications": notifications_html}


def group_notifications_by_client(
    notifications: List[Dict[str, Any]],
) -> Dict[str, List[Dict[str, Any]]]:
    """
    Group notifications per client and sort each list:
      1. High severity first
      2. More occurrences first
      3. More distinct errors first
    """
    grouped: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for n in notifications:
        log = n.get("log_entry", {})
        cid = log.get("client_id", log.get("ClientId", "unknown"))
        grouped[cid].append(n)

    sev_rank = {"High": 0, "Medium": 1, "Low": 2}
    for lst in grouped.values():
        lst.sort(key=lambda n: sev_rank.get(n.get("severity", "Medium"), 1))

    def sort_key(item):
        _, lst = item
        has_high = any(n.get("severity") == "High" for n in lst)
        high_count = sum(1 for n in lst if n.get("severity") == "High")
        occ_sum = sum(n.get("log_entry", {}).get("occurrences", 1) for n in lst)
        return (not has_high, -high_count, -occ_sum, -len(lst))

    return dict(sorted(grouped.items(), key=sort_key))
