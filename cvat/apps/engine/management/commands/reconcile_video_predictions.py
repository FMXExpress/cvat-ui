# Copyright (C) CVAT.ai Corporation
#
# SPDX-License-Identifier: MIT

from django.core.management.base import BaseCommand

from cvat.apps.engine.views import JobViewSet


class Command(BaseCommand):
    help = "Reconcile stale pending video prediction requests"

    def add_arguments(self, parser):
        parser.add_argument(
            "--limit",
            type=int,
            default=None,
            help="Maximum number of recent requests to scan in this run",
        )

    def handle(self, *args, **options):
        stats = JobViewSet.reconcile_pending_video_prediction_requests(limit=options.get("limit"))
        self.stdout.write(
            self.style.SUCCESS(
                "Video prediction reconciliation finished "
                f"(scanned={stats['scanned']}, stale={stats['stale']}, "
                f"reconciled={stats['reconciled']}, timed_out={stats['timed_out']}, "
                f"skipped={stats['skipped']})"
            )
        )
