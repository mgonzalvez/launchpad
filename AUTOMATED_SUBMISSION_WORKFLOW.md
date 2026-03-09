# Automated Submission Workflow Proposal

This document captures a proposed future workflow for automating project intake for PnP Launchpad while preserving full admin approval before anything goes live.

## Current Workflow

Today the flow works like this:

1. A creator submits the form in `submit.html`.
2. The form sends:
   - an email via `formsubmit.co` to `mgonzalvez@gmail.com`
   - a JSON payload to a Google Apps Script webhook
3. The Apps Script appends the text fields to a Google Sheet.
4. If the creator uploads an image, that image is attached to the email.
5. The uploaded image does **not** automatically go into the repo `uploads/` folder.
6. Site updates still require manual work:
   - copy project details from the Google Sheet
   - identify or move the uploaded image manually
   - update `data/content.json`
   - upload the changed files to GitHub Pages / the repo

## Main Problem

The metadata and the images are split across two different systems:

- project metadata lives in Google Sheets
- uploaded images arrive as email attachments

That means the most important part of the workflow is still manual: matching form rows to image files and then wiring both into the repo.

## Recommended Future Workflow

Keep Google Sheets as the intake queue, use Google Drive for uploaded images, and use GitHub Actions to generate reviewable repo changes.

### Target Flow

1. Creator submits the form.
2. Google Apps Script receives the submission.
3. Apps Script:
   - appends structured fields to Google Sheets
   - saves uploaded image files into a dedicated Google Drive folder
   - writes the Drive file ID or public image URL into the same sheet row
4. Sheet includes an admin approval column such as:
   - `pending`
   - `approved`
   - `rejected`
   - optionally `published`
5. A GitHub Action runs on schedule or manually.
6. The GitHub Action:
   - reads approved, unpublished rows from the sheet
   - downloads the referenced image from Drive
   - stores the image in `uploads/`
   - updates `data/content.json`
   - marks the row as published or writes back a published timestamp
   - opens a pull request with the new content
7. Admin reviews the pull request and merges it.
8. Site deploy happens normally from GitHub Pages.

## Why This Is The Best Fit

This approach works well for the current site because:

- it preserves the existing form-based creator workflow
- it keeps Google Sheets as the admin intake queue
- it preserves Git as the source of truth for published site data
- it adds automation without exposing repo write credentials in the browser
- it preserves full admin approval before any listing goes live

## Why Not Update The Repo Directly From The Browser

The site is static and hosted like a GitHub Pages site. Writing directly to the repo from a public client-side form would require credentials or a privileged write endpoint. That is the wrong place to put trust and would be harder to secure and maintain.

The browser should submit data into an intake system. A controlled backend or automation layer should prepare repo changes.

## Minimum Viable Automation

If full automation is too much upfront, the smallest useful improvement is:

1. keep the Google Sheet
2. store uploaded images automatically in Google Drive
3. write the image link into the row

That alone removes the current need to recover image files from email attachments.

## Full Recommended Architecture

### Intake

- `submit.html`
- Google Apps Script Web App
- Google Sheet
- Google Drive image folder

### Approval

- admin changes sheet row status from `pending` to `approved`

### Publishing

- GitHub Action
- sync script in repo
- pull request created automatically

## Suggested Sheet Columns

Suggested columns for the Google Sheet:

- `submitted_at`
- `status`
- `published_at`
- `submitter_email`
- `project_title`
- `project_url`
- `submission_type`
- `is_preview`
- `start_date`
- `end_date`
- `designer`
- `publisher`
- `late_pledge_available`
- `late_pledge_url`
- `project_summary`
- `image_url`
- `image_uploaded`
- `image_file_name`
- `drive_file_id`
- `drive_public_url`
- `notes`

## Suggested Approval States

Use a simple status model:

- `pending`
- `approved`
- `rejected`
- `published`

This is enough for a lightweight admin workflow.

## Repo Changes Needed Later

To implement the full workflow later, the repo would likely need:

- a sync script to read approved rows and normalize them into project JSON
- a script to download and rename images into `uploads/`
- a GitHub Actions workflow to run the sync
- a rule for deterministic image file naming
- duplicate detection based on project URL and/or slug

## Image Handling Recommendation

Use a deterministic local filename pattern in the repo, for example:

- `uploads/<slug>.png`
- `uploads/<slug>.jpg`

That avoids manual naming inconsistencies and makes future updates easier.

## Proposed Implementation Order

When ready to implement, this is the recommended order:

1. update Apps Script so uploaded images are saved to Google Drive
2. add image reference columns to the Google Sheet
3. add an approval column and admin workflow
4. add a repo sync script that converts approved rows into `data/content.json` entries
5. add GitHub Action to run the sync and open a PR
6. optionally remove the email attachment workflow later

## End State Goal

The desired end state is:

- creators submit once
- images are stored automatically
- submissions land in a structured queue
- admin approves rows
- GitHub PR is generated automatically
- admin merges
- site updates without manual copy/paste

This keeps control centralized while removing the repetitive manual work currently required for every submission.
