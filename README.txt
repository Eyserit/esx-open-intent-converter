ESX TO OPEN INTENT CONVERTER, WITH MERAKI UPLOAD
================================================

This tool does two things:

  1. Converts Wi-Fi designs between Ekahau (.esx) and Open Intent (.zip),
     in either direction.
  2. Uploads floor plans to a Cisco Meraki Dashboard network and places
     your access points on them.

There are two ways to use it:

  - THE WEBSITE: converts files only. There's nothing to install:
        https://eyserit.github.io/esx-open-intent-converter/

  - THE LOCAL VERSION: converts files AND uploads to Meraki. You run it
    on your own computer by following steps 1 to 4 below. It takes
    about 5 minutes the first time.


STEP 1: INSTALL NODE.JS (ONCE)
------------------------------

The local version runs on Node.js, version 22 or later.

  1. Check whether you already have it. Open a terminal:
       macOS:   press Cmd+Space, type "Terminal", press Return.
       Windows: press the Windows key, type "cmd", press Enter.
     Then type:

         node --version

     If it prints v22 or higher (for example v22.11.0), go to step 2.

  2. Otherwise, download the "LTS" installer from https://nodejs.org and
     run it, accepting the defaults.

  3. Close the terminal, open a new one, and run "node --version" again
     to check it worked.


STEP 2: GET THE TOOL (ONCE)
---------------------------

Choose ONE of these.

  OPTION A: CLONE WITH GIT (recommended; updating is one command)

    1. Check that Git is installed. In a terminal, type:

           git --version

       If you get an error, install Git from https://git-scm.com/downloads
       (on macOS you can also accept the prompt to install the developer
       tools), then open a new terminal.

    2. Go to the folder where you want the tool to live, e.g. Documents:

           macOS:    cd ~/Documents
           Windows:  cd %USERPROFILE%\Documents

    3. Clone it:

           git clone https://github.com/Eyserit/esx-open-intent-converter.git

       This creates a folder called "esx-open-intent-converter".

  OPTION B: DOWNLOAD A ZIP (no Git needed)

    1. Open https://github.com/Eyserit/esx-open-intent-converter
    2. Click the green "Code" button, then "Download ZIP".
    3. Unzip the file, e.g. into your Documents folder. You get a folder
       called "esx-open-intent-converter-main".


STEP 3: START THE TOOL (EVERY TIME YOU USE IT)
---------------------------------------------

  1. Open a terminal in the tool's folder. If you cloned into Documents:

         macOS:    cd ~/Documents/esx-open-intent-converter
         Windows:  cd %USERPROFILE%\Documents\esx-open-intent-converter

     If you downloaded the ZIP, the folder name ends in "-main".
     Shortcut on macOS: type "cd " (with a space), drag the folder onto the
     Terminal window, then press Return.

  2. Start it:

         npm start

     You should see:

         Converter running at http://localhost:8000 — press Ctrl+C to stop.

     There is nothing to install first: no "npm install" is needed.

  3. Open this address in your web browser:

         http://localhost:8000

  4. Leave the terminal window open while you use the tool. Closing it
     stops the tool.


STEP 4: STOP THE TOOL
---------------------

  Click in the terminal window and press Ctrl+C. To use it again later,
  repeat step 3.


IF PORT 8000 IS ALREADY IN USE
------------------------------

If "npm start" fails with "EADDRINUSE" or "address already in use",
another program is using port 8000. Start on another port, e.g. 8001:

  macOS / Linux:        PORT=8001 npm start
  Windows (cmd):        set PORT=8001 && npm start
  Windows (PowerShell): $env:PORT=8001; npm start

Then open http://localhost:8001 instead.


UPDATING TO THE LATEST VERSION
------------------------------

  If you cloned (option A): in the tool's folder, run

      git pull

  If you downloaded the ZIP (option B): download it again and replace the
  old folder.

Then start the tool as in step 3.


USING THE TOOL
--------------

Convert a file:

  1. Drop an .esx or Open Intent .zip file on the page, or click
     "Choose file". The tool works out which way to convert by itself.
  2. Click "Download" to save the converted file.

Send to Meraki (local version only):

  You need a Meraki Dashboard API key with access to the organisation and
  network. To create one in Dashboard, go to My Profile > API access.

  1. After a conversion, click "Send to Meraki".
  2. Pick your Dashboard region, then paste your API key and click
     Connect.
  3. Pick the organisation, then the wireless network.
  4. Floors: tick the floors to upload. You can change each floor's
     "Name in Meraki". Meraki allows up to 25 characters: letters,
     numbers, spaces, - and _.
     If a floor plan with exactly that name already exists in the network,
     it is updated rather than created again.
  5. Place each floor on the map. Search for the address or paste
     coordinates (e.g. 53.3498, -6.2603), then drag the outline into
     place and rotate it to line up with the building.
     If several floors are the same building, tick "These floors are one
     building: place them together" and place the building once.
  6. Click Upload. The floor plans are uploaded first. Then your access
     points are placed on them automatically:
       - Each AP is matched to an AP already claimed into the Meraki
         network, first by name, then (for Ekahau survey projects) by
         BSSID.
       - The tool doesn't claim or create APs, so they must already be in
         the network.
       - An AP already on another floor plan is left alone.
       - A results list shows what was placed, moved, skipped or not
         matched.
  7. Click "Open in Dashboard" to check the result, or "Disconnect" to go
     back to your converted file.


YOUR DATA AND YOUR API KEY
--------------------------

  - Files are converted inside your browser. Nothing is uploaded anywhere
    except the floor plans you choose to send to Meraki.
  - Your API key is kept only in the open browser tab, and only while you
    use the Meraki steps. It is not saved anywhere, not logged, and is
    forgotten when you click Disconnect or close the tab.
  - The key goes only from your computer to Meraki, always over HTTPS.
    The local server listens only on your own computer (127.0.0.1), so
    other devices on your network can't reach it.
  - The map uses OpenStreetMap for map images and address search. Those
    services see your IP address and what you search for. They never see
    your API key or your files.
  - Files can be up to 100 MB.

Tip: use an API key from a Dashboard account that can only see the
organisations you need. If you're trying the tool for the first time,
upload to a test network.


TROUBLESHOOTING
---------------

  "npm: command not found" or "'npm' is not recognized"
      Node.js isn't installed, or the terminal was opened before it was
      installed. Install it (step 1) and open a new terminal.

  "git: command not found" or "'git' is not recognized"
      Git isn't installed. Install it (step 2, option A), or use the ZIP
      download (option B) instead.

  "npm error ... Missing script: start" or "Could not read package.json"
      The terminal isn't in the tool's folder. "cd" into the folder that
      contains package.json (step 3) and try again.

  "EADDRINUSE" or "address already in use"
      Another program is using the port. See "If port 8000 is already in
      use" above.

  No "Send to Meraki" button after a conversion
      You're on the public website, or the page wasn't opened from
      "npm start". Open the http://localhost address shown in the
      terminal.

  "The local server isn't running — restart it with npm start."
      The terminal running the tool was closed or stopped. Run
      "npm start" again and reload the page.

  "That API key wasn't accepted by Meraki"
      Check the key, and that you picked the right region (Global,
      Canada, China, India or US FedRAMP).

  An access point says "Not matched"
      Its name in the design doesn't match any AP in the network, and it
      had no survey BSSIDs to fall back on. Rename the AP in Dashboard or
      in the design so the names match, then upload again.

  Address search doesn't find the building
      Paste coordinates instead. In Google Maps, right-click the building
      and click the numbers at the top of the menu to copy them.

Tested on macOS. Windows and Linux should work the same way but haven't
been tested.
